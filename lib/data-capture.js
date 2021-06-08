const SensorConfig = require('./sensor-config.js')
var path = require('path');
var util = require("util");
var MetaWear = require('metawear');
var fs = require('fs');
var ref = require('ref');
var readline = require('readline')
var Session = undefined;

module.exports.createState = async function(capture, sensor, options) {
  let state = {}

  if ('csv' in options) {
    let csv = options['csv'];
    state['path'] = path.join(csv['root'], util.format("%s_%s_%s_%s.csv", csv['name'], csv['now'], csv['address'].toUpperCase().replace(/:/g, ""), sensor))

    var exists = await new Promise((resolve, reject) => {
      var lineReader = readline.createInterface({
        input: fs.createReadStream(state['path']).on('error', (err) => resolve(false))
      });
      var first = true;
      lineReader.on('line', line => {
        if (!first) {
          var parts = line.split(",");
          var buf = ref.alloc('int64');
          ref.writeInt64LE(buf, 0, parts[0]);
  
          if (!('first' in state)) {
            state['first'] = ref.readInt64LE(buf, 0);
          }
        }
        first = false;
      });
      lineReader.on('close', () => {
        resolve(true);
      });
    })

    let stream = fs.createWriteStream(state['path'], { 'flags': exists ? "a" : "w" })
    if (!exists) {
      SensorConfig[sensor].csvHeader(stream);
    }
    state['csv'] = stream;
  }

  capture(MetaWear.FnVoid_VoidP_DataP.toPointer((ctx, pointer) => SensorConfig[sensor].writeValue(pointer.deref(), state)));

  return state;
}
