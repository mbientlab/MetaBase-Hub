var fs = require('fs');
var winston = require('winston');
const CLO = require('./lib/clo.js');

const CACHE_FILENAME = '.cache.json';
// We save the state of the MetaWear device so that we can download it later
var cache = fs.existsSync(CACHE_FILENAME) ? JSON.parse(fs.readFileSync(CACHE_FILENAME, 'utf8')) : {};

var args = CLO.setup().parseArgs();
var config;

if (args['list_sensors'] != null) {
    console.log("Available Sensors")
    console.log("-----------------")
    Object.keys(SensorConfig).forEach(s => console.log(s))
    process.exit(0)
}
if (args['config'] != null) {
    config = JSON.parse(fs.readFileSync(args['config'], 'utf8'));
    config['devices'] = config['devices'].map(d => typeof(d) === 'string' ? ({'mac': d }) : d)
    Object.keys(config['sensors']).forEach(k  => {
        if (typeof(config['sensors'][k]) === 'number') {
            config['sensors'][k] = {odr: config['sensors'][k]}
        }
    })
} else {
    config = {}
    if (args['device'] != null) {
        config["devices"] = args['device'].map(d => {
            const parts = d.split("=");
            return parts.length == 1 ? {'mac': d} : {'mac': parts[0], 'name': parts[1]}
        })
    }
    if (args['sensor'] != null) {
        config["sensors"] = args['sensor'].reduce((acc, s) => {
            const parts = s.split("=");
            acc[parts[0]] = isNaN(parts[1]) ? JSON.parse(parts[1]) : {"odr" : parseFloat(parts[1])}
            return acc
        }, {})
    }

    if (args['cloud_user'] != null && args['cloud_passwd'] != null) {
        config["cloudLogin"] = {
            "username" : args['cloud_user'],
            "password" : args['cloud_passwd']
        }
    } else if (!(args['cloud_user'] == null && args['cloud_passwd'] == null)) {
        winston.error("'--cloud-user' and '--cloud-passwd' required to sync to MetaCloud");
        process.exit(0);
    }

    if (args['fps'] != null) {
        config['fps'] = args['fps']
    }

    config["resolution"] = {
        "width": args["width"],
        "height": args["height"]
    }
}

if (!('fps' in config)) {
    config['fps'] = 10
}

if (!('command' in config)) {
    config['command'] = args['command'] === null ? 'stream' : args['command']
}

const CSV_DIR = args['o'] != null ? args['o'] : "output";
if (!fs.existsSync(CSV_DIR)){
    fs.mkdirSync(CSV_DIR);
}
config['csv'] = CSV_DIR

switch(config['command']) {
case 'stream':
    require('./lib/command-stream.js')(config, args['no_graph'] != null, cache, CACHE_FILENAME)
    break;
case 'log':
    require('./lib/command-log.js')(config, cache, CACHE_FILENAME);
    break;
case 'download':
    require('./lib/command-download.js')(config, cache, CACHE_FILENAME);
    break;
}