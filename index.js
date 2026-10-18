import { Command } from 'commander';
import fs from 'fs';

const program = new Command();

program
    .name('meteo')
    .description('Програма для перегляду даних метеостанції')
    .version('1.0.0', '-V, --version', 'показати версію програми')
    .helpOption('-h, --help', 'показати довідку')
    .helpCommand('help [command]', 'показати довідку для команди')
    .option('-f, --file <path>', 'шлях до JSON-файлу з даними', 'data.json')
    .configureOutput({
        // перекладаємо повідомлення commander про помилки українською
        outputError: (str, write) => write(
            str
                .replace('error: missing required argument', "Помилка: не вказано обов'язковий аргумент")
                .replace('error: unknown option', 'Помилка: невідома опція')
                .replace('error: unknown command', 'Помилка: невідома команда')
                .replace('error: too many arguments', 'Помилка: забагато аргументів')
                .replace('error: option', 'Помилка: опція')
                .replace('argument missing', 'потребує значення')
                .replace('Did you mean', 'Можливо, ви мали на увазі')
        )
    });

// Читає JSON-файл, шлях до якого вказано в опції --file
function readData() {
    const file = program.opts().file;
    try {
        const text = fs.readFileSync(file, 'utf8');
        return JSON.parse(text);
    } catch (err) {
        if (err.code === 'ENOENT') {
            console.error(`Помилка: файл "${file}" не знайдено.`);
        } else {
            console.error(`Помилка: файл "${file}" містить некоректний JSON.`);
        }
        process.exit(1);
    }
}

// Шукає датчик за його sensorId
function findSensor(data, id) {
    const sensor = data.sensors.find((s) => s.sensorId === id);
    if (!sensor) {
        console.error(`Помилка: датчик з ID "${id}" не знайдено.`);
        process.exit(1);
    }
    return sensor;
}

// Перевіряє, чи є показ (value не null і не відсутнє)
function hasValue(reading) {
    return reading.value !== null && reading.value !== undefined;
}

// Команда list — перелік датчиків
program
    .command('list')
    .description('показати перелік датчиків')
    .option('-l, --limit <number>', 'скільки датчиків показати')
    .action((options) => {
        const data = readData();
        let sensors = data.sensors;

        if (options.limit !== undefined) {
            const limit = Number(options.limit);
            if (!Number.isInteger(limit) || limit <= 0) {
                console.error('Помилка: --limit має бути цілим додатним числом.');
                process.exit(1);
            }
            sensors = sensors.slice(0, limit);
        }

        console.log(`Станція: ${data.stationId} | Дата: ${data.date} | Місце: ${data.location}`);
        console.log('--- Датчики ---');
        sensors.forEach((s, i) => {
            console.log(`${i + 1}. ${s.sensorId} (${s.type}, ${s.unit})`);
        });
    });

// Команда sensor — один датчик повністю
program
    .command('sensor')
    .description('показати один датчик повністю')
    .argument('<id>', 'ID датчика, наприклад S-TEMP-01')
    .action((id) => {
        const data = readData();
        const sensor = findSensor(data, id);
        console.log(JSON.stringify(sensor, null, 2));
    });

// Команда field — окреме поле датчика (можна вкладене через крапку)
program
    .command('field')
    .description('показати окреме поле датчика')
    .argument('<id>', 'ID датчика')
    .argument('<path>', 'назва поля, вкладені через крапку, наприклад readings.0.value')
    .action((id, path) => {
        const data = readData();
        const sensor = findSensor(data, id);

        let value = sensor;
        for (const key of path.split('.')) {
            if (value === null || typeof value !== 'object' || !(key in value)) {
                console.error(`Помилка: поле "${path}" відсутнє у датчика ${id}.`);
                process.exit(1);
            }
            value = value[key];
        }

        if (value === null) {
            console.log(`Поле "${path}" існує, але має значення null (немає даних).`);
        } else {
            console.log(`${path}: ${JSON.stringify(value)}`);
        }
    });

// Команда info — характеристики обраного датчика
program
    .command('info')
    .description('показати характеристики датчика')
    .argument('<id>', 'ID датчика')
    .action((id) => {
        const data = readData();
        const sensor = findSensor(data, id);
        const missing = sensor.readings.filter((r) => !hasValue(r)).length;

        console.log(`Датчик: ${sensor.sensorId}`);
        console.log(`Тип: ${sensor.type}`);
        console.log(`Одиниці: ${sensor.unit}`);
        console.log(`Стан: ${sensor.active ? 'працює' : 'вимкнений'}`);
        console.log(`Станція: ${data.stationId} (${data.location})`);
        console.log(`Кількість показів: ${sensor.readings.length}, з них відсутніх: ${missing}`);
    });

// Команда readings — серія показів датчика
program
    .command('readings')
    .description('показати серію показів датчика')
    .argument('<id>', 'ID датчика')
    .option('-s, --skip-missing', 'не показувати відсутні покази')
    .action((id, options) => {
        const data = readData();
        const sensor = findSensor(data, id);

        let readings = sensor.readings;
        if (options.skipMissing) {
            readings = readings.filter(hasValue);
        }

        console.log(`Покази ${sensor.sensorId} (${sensor.unit}) за ${data.date}:`);
        console.table(readings);
    });

// Команда stats — мінімум, максимум і середнє без відсутніх показів
program
    .command('stats')
    .description('мінімум, максимум і середнє значення датчика')
    .argument('<id>', 'ID датчика')
    .action((id) => {
        const data = readData();
        const sensor = findSensor(data, id);

        const values = sensor.readings.filter(hasValue).map((r) => r.value);
        if (values.length === 0) {
            console.log(`У датчика ${id} немає жодного показу для розрахунку.`);
            return;
        }

        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((sum, v) => sum + v, 0) / values.length;

        console.log(`Статистика ${sensor.sensorId} (${sensor.type}):`);
        console.log(`Враховано показів: ${values.length} з ${sensor.readings.length}`);
        console.log(`Мінімум: ${min}${sensor.unit}`);
        console.log(`Максимум: ${max}${sensor.unit}`);
        console.log(`Середнє: ${avg.toFixed(2)}${sensor.unit}`);
    });

program.parse();