const MetaWear = require('metawear');
const os = require("os");
const util = require("util");
const moment = require("moment");
var ref = require('ref')

const CSV_HEADER_ROOT= "epoch (ms),time (%s),elapsed (s),";

// Cartesian - helper function
function writeCartesianFloatType(data, state, name) {
    let value = data.parseValue()
    let entry = [value.x, value.y, value.z]
    state['csv'].write(util.format("%d,%s,%s,%s,%s,%s%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
        entry[0].toFixed(3), entry[1].toFixed(3), entry[2].toFixed(3), os.EOL))
    if ('update-graph' in state) {
        state['update-graph'](entry)
    }
}

// Float - helper function
function writeFloatType(data, state, name) {
    let value = data.parseValue()
    let entry = [value]
    state['csv'].write(util.format("%d,%s,%s,%s%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
        entry[0].toFixed(3), os.EOL))
    if ('update-graph' in state) {
        state['update-graph'](entry)
    }
}

// Timer - helper function
function formatTime(epoch) {
    return moment(epoch).format("YYYY-MM-DDTHH:mm:ss.SSS");
}

// Elapsed - helper function
function formatElapsed(epoch, state) {
    if (!('first' in state)) {
        state['first'] = epoch;
    }
    return ((epoch - state['first']) / 1000.0).toFixed(3);
}

// Closest - helper function
function closest(values, key) {
    var smallest = Math.abs(values[0] - key);
    var place = 0;
    for(var i = 1; i < values.length; i++) {
        var dist = Math.abs(values[i] - key);
        if (dist < smallest) {
            smallest = dist;
            place = i;
        }
    }
    return place;
}

// Setting - Main
function Setting(header, configure, start, signal, writeValue, exists, odrToMs) {
    this.configure = configure;
    this.start = start;
    this.csvHeader = (stream) => stream.write(util.format(CSV_HEADER_ROOT + header + os.EOL, moment().format("Z")));
    this.signal = signal;
    this.writeValue = writeValue;
    this.exists = exists;
    this.odrToMs = odrToMs;
}

// Setting Hz
function SettingHz(header, configure, start, signal, writeValue, exists) {
    return new Setting(header, configure, start, signal, writeValue, exists, config => 1000.0 / config['odr'])
}

// Sensor Fusion
function SensorFusionSetting(header, type, writeValue) {
    return new Setting(header, (board, config) => {
        let accRange = 'accRange' in config ? config['accRange'] : 16.0
        let gyrRange = 'gyrRange' in config ? config['gyrRange'] : 2000.0
        MetaWear.mbl_mw_sensor_fusion_set_mode(board, MetaWear.SensorFusionMode.NDOF);
        MetaWear.mbl_mw_sensor_fusion_set_acc_range(board, 
            MetaWear.SensorFusionAccRange.enums[closest([2.0, 4.0, 8.0, 16.0], accRange)].value);
        MetaWear.mbl_mw_sensor_fusion_set_gyro_range(board, 
            MetaWear.SensorFusionGyroRange.enums[closest([2000.0, 1000.0, 500.0, 250.0], gyrRange)].value);
        MetaWear.mbl_mw_sensor_fusion_write_config(board);
        return Promise.resolve(null)
    }, (board) => {
        MetaWear.mbl_mw_sensor_fusion_enable_data(board, type);
        MetaWear.mbl_mw_sensor_fusion_start(board);
    }, (board, packed) => {
        return MetaWear.mbl_mw_sensor_fusion_get_data_signal(board, type);
    }, writeValue, (board) => {
        return MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.SENSOR_FUSION) != MetaWear.Const.MODULE_TYPE_NA;
    }, odr => 10);
}

// Timed Sensors
function TimedSensorSetting(csvHeader, getSignal, writeValue, exists) {
    var timers = {}
    return new Setting(csvHeader, async (board, config) => {
        let timer = await new Promise((resolve, reject) => 
            MetaWear.mbl_mw_timer_create_indefinite(board, ('period' in config ? config['period'] : config['odr']) * 1000, 0, ref.NULL, MetaWear.FnVoid_VoidP_TimerP.toPointer((ctx, ptr) => resolve(ptr)))
        );
        return new Promise((resolve, reject) => {
            MetaWear.mbl_mw_event_record_commands(timer);
            MetaWear.mbl_mw_datasignal_read(getSignal(board))
            MetaWear.mbl_mw_event_end_record(timer, ref.NULL, MetaWear.FnVoid_VoidP_EventP_Int.toPointer((ctx, ptr, status) => {
                timers[board] = timer
                resolve(null);
            }))
        })
    }, board => {
        MetaWear.mbl_mw_timer_start(timers[board]);
    }, getSignal, writeValue, exists, config => 1000 * ('period' in config ? config['period'] : config['odr']))
}

// Temperature
function TemperatureSetting() {
    var thermistorChannels = {}
    return new TimedSensorSetting("temperature (C)", (board, packed) => MetaWear.mbl_mw_multi_chnl_temp_get_temperature_data_signal(board, thermistorChannels[board]), 
        (data, state) => writeFloatType(data, state, "Temperature"), 
        board => {
            let nChnls = MetaWear.mbl_mw_multi_chnl_temp_get_num_channels(board);
            for(let channel = 0; channel < nChnls; channel++) {
                if (MetaWear.mbl_mw_multi_chnl_temp_get_source(board, channel) === MetaWear.TemperatureSource.PRESET_THERM) {
                    thermistorChannels[board]= channel;
                    return true;
                }
            }
            return false
        })
}

// Humidity
function HumiditySetting() {
    return new TimedSensorSetting("relative humidity (%)", (board, packed) => MetaWear.mbl_mw_humidity_bme280_get_percentage_data_signal(board), 
        (data, state) => writeFloatType(data, state, "Humidity"), 
        board => MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.HUMIDITY) != MetaWear.Const.MODULE_TYPE_NA)
}

// Setting - Header, Configure, Start, Signal, WriteValue
module.exports = {
    // Configure
    "Accelerometer": new SettingHz("x-axis (g),y-axis (g),z-axis (g)", (board, config) => {
        MetaWear.mbl_mw_acc_set_range(board, 'range' in config ? config['range'] : 16.0);
        MetaWear.mbl_mw_acc_set_odr(board, config['odr']);
        MetaWear.mbl_mw_acc_write_acceleration_config(board);
        return Promise.resolve(null)
    // Start
    }, (board) => {
        MetaWear.mbl_mw_acc_enable_acceleration_sampling(board);
        MetaWear.mbl_mw_acc_start(board);
    // Signal
    }, (board, packed) => {
        return packed ? MetaWear.mbl_mw_acc_get_packed_acceleration_data_signal(board) : MetaWear.mbl_mw_acc_get_acceleration_data_signal(board)
    // Write Value
    }, (data, state) => writeCartesianFloatType(data, state, "Accelerometer"), (board) => {
        return MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.ACCELEROMETER) != MetaWear.Const.MODULE_TYPE_NA;
    }),
    // Configure
    "Gyroscope" : new SettingHz("x-axis (deg/s),y-axis (deg/s),z-axis (deg/s)", (board, config) => {
        let range = 'range' in config ? closest([2000.0, 1000.0, 500.0, 250.0, 125.0], config['range']) : 0
        if (board.modelNumber == '8') {
            MetaWear.mbl_mw_gyro_bmi270_set_range(board, MetaWear.GyroBoschRange.enums[range].value);
            MetaWear.mbl_mw_gyro_bmi270_set_odr(board, MetaWear.GyroBoschOdr.enums[closest([25.0, 50.0, 100.0, 200.0], config['odr'])].value);
            MetaWear.mbl_mw_gyro_bmi270_write_config(board);

        } else {
            MetaWear.mbl_mw_gyro_bmi160_set_range(board, MetaWear.GyroBoschRange.enums[range].value);
            MetaWear.mbl_mw_gyro_bmi160_set_odr(board, MetaWear.GyroBoschOdr.enums[closest([25.0, 50.0, 100.0, 200.0], config['odr'])].value);
            MetaWear.mbl_mw_gyro_bmi160_write_config(board);
        } 
        return Promise.resolve(null)
    // Start
    }, (board) => {
        if (board.modelNumber == '8') {
            MetaWear.mbl_mw_gyro_bmi270_enable_rotation_sampling(board);
            MetaWear.mbl_mw_gyro_bmi270_start(board);
        } else {
            MetaWear.mbl_mw_gyro_bmi160_enable_rotation_sampling(board);
            MetaWear.mbl_mw_gyro_bmi160_start(board);
        }
    // Signal
    }, (board, packed) => {
        if (board.modelNumber == '8') {
            return packed ? MetaWear.mbl_mw_gyro_bmi270_get_packed_rotation_data_signal(board) : MetaWear.mbl_mw_gyro_bmi270_get_rotation_data_signal(board);
        } else {
            return packed ? MetaWear.mbl_mw_gyro_bmi160_get_packed_rotation_data_signal(board) : MetaWear.mbl_mw_gyro_bmi160_get_rotation_data_signal(board);
        }
    // Write Value
    }, (data, state) => writeCartesianFloatType(data, state, "Gyroscope"), (board) => {
        return MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.GYRO) != MetaWear.Const.MODULE_TYPE_NA;
    }),
    "Magnetometer" : new SettingHz("x-axis (T),y-axis (T),z-axis (T)", (board, config) => {
        MetaWear.mbl_mw_mag_bmm150_configure(board, 9, 15, MetaWear.MagBmm150Odr.enums[closest([10.0, 2.0, 6.0, 8.0, 15.0, 20.0, 25.0], config['odr'])].value);
        return Promise.resolve(null)
    }, (board) => {
        MetaWear.mbl_mw_mag_bmm150_enable_b_field_sampling(board);
        MetaWear.mbl_mw_mag_bmm150_start(board);
    }, (board, packed) => {
        return packed ? MetaWear.mbl_mw_mag_bmm150_get_packed_b_field_data_signal(board) : MetaWear.mbl_mw_mag_bmm150_get_b_field_data_signal(board);
    }, (data, state) => {
        let value = data.parseValue()
        let entry = [(value.x / 1000000.0), (value.y / 1000000.0), (value.z / 1000000.0)]
        state['csv'].write(util.format("%d,%s,%s,%s,%s,%s%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
            entry[0].toFixed(9), entry[1].toFixed(9), entry[2].toFixed(9), os.EOL))
        if ('update-graph' in state) {
            state['update-graph'](entry)
        }
    }, (board) => {
        return MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.MAGNETOMETER) != MetaWear.Const.MODULE_TYPE_NA;
    }),
    "Quaternion" : new SensorFusionSetting("w (number),x (number),y (number), z (number)", MetaWear.SensorFusionData.QUATERNION, (data, state) => {
        let value = data.parseValue()
        let entry = [value.w, value.x, value.y, value.z]
        state['csv'].write(util.format("%d,%s,%s,%s,%s,%s,%s%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
            entry[0].toFixed(3), entry[1].toFixed(3), entry[2].toFixed(3), entry[3].toFixed(3), os.EOL))
        if ('update-graph' in state) {
            state['update-graph'](entry)
        }
    }),
    "Euler Angles" : new SensorFusionSetting("pitch (deg),roll (deg),yaw (deg), heading (deg)", MetaWear.SensorFusionData.EULER_ANGLE, (data, state) => {
        let value = data.parseValue()
        let entry = [value.pitch, value.roll, value.yaw]
        state['csv'].write(util.format("%d,%s,%s,%s,%s,%s,%s%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), 
            entry[0].toFixed(3), entry[1].toFixed(3), entry[2].toFixed(3), value.heading.toFixed(3), os.EOL))
        if ('update-graph' in state) {
            state['update-graph'](entry)
        }
    }),
    "Linear Acceleration" : new SensorFusionSetting("x-axis (g),y-axis (g),z-axis (g)", MetaWear.SensorFusionData.LINEAR_ACC, 
        (data, state) => writeCartesianFloatType(data, state, "Linear Acceleration")
    ),
    "Gravity" : new SensorFusionSetting("x-axis (g),y-axis (g),z-axis (g)", MetaWear.SensorFusionData.GRAVITY_VECTOR, 
        (data, state) => writeCartesianFloatType(data, state, "Gravity")
    ),
    "Ambient Light" : new SettingHz("illuminance (lx)", (board, config) => {
        let gain = 'gain' in config ? config['gain'] : 1;
        MetaWear.mbl_mw_als_ltr329_set_gain(board, MetaWear.AlsLtr329Gain.enums[closest([1, 2, 4, 8, 48, 96], gain)].value);
        MetaWear.mbl_mw_als_ltr329_set_integration_time(board, MetaWear.AlsLtr329IntegrationTime._100ms);
        MetaWear.mbl_mw_als_ltr329_set_measurement_rate(board, MetaWear.AlsLtr329MeasurementRate.enums[closest([0.5, 1.0, 2.0, 5.0, 10.0], 1.0 / config['odr'])].value);
        MetaWear.mbl_mw_als_ltr329_write_config(board);
        return Promise.resolve(null)
    }, board => {
        MetaWear.mbl_mw_als_ltr329_start(board);
    }, (board, packed) => {
        return MetaWear.mbl_mw_als_ltr329_get_illuminance_data_signal(board);
    }, (data, state) => {
        let value = data.parseValue() / 1000.0
        let entry = [value]
        state['csv'].write(util.format("%d,%s,%s,%s%s", data.epoch, formatTime(data.epoch), formatElapsed(data.epoch, state), entry[0].toFixed(3), os.EOL))
        if ('update-graph' in state) {
            state['update-graph'](entry)
        }
    }, board => {
        return MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.AMBIENT_LIGHT) != MetaWear.Const.MODULE_TYPE_NA;
    }),
    "Pressure" : new SettingHz("pressure (Pa)", (board, config) => {
        MetaWear.mbl_mw_baro_bosch_set_iir_filter(board, MetaWear.BaroBoschIirFilter.OFF);
        // Should be standard oversampling but have to use low power to get the desired ODR
        MetaWear.mbl_mw_baro_bosch_set_oversampling(board, MetaWear.BaroBoschOversampling.LOW_POWER);
        let model = MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.BAROMETER);
        switch(model) {
        case MetaWear.Const.MODULE_BARO_TYPE_BMP280:
            MetaWear.mbl_mw_baro_bmp280_set_standby_time(board, 
                MetaWear.BaroBmp280StandbyTime.enums[closest([83.33, 13.51, 7.33, 3.82, 1.96, 0.99, 0.50, 0.25], config['odr'])].value);
            break;
        case MetaWear.Const.MODULE_BARO_TYPE_BME280:
            MetaWear.mbl_mw_baro_bme280_set_standby_time(board, 
                MetaWear.BaroBmp280StandbyTime.enums[closest([83.33, 13.51, 7.33, 3.82, 1.96, 0.99, 46.51, 31.75], config['odr'])].value);
            break;
        }
        MetaWear.mbl_mw_baro_bosch_write_config(board);
        return Promise.resolve(null)
    }, board => {
        MetaWear.mbl_mw_baro_bosch_start(board);
    }, (board, packed) => {
        return MetaWear.mbl_mw_baro_bosch_get_pressure_data_signal(board);
    }, (data, state) => writeFloatType(data, state, "Pressure"), board => {
        return MetaWear.mbl_mw_metawearboard_lookup_module(board, MetaWear.Module.BAROMETER) != MetaWear.Const.MODULE_TYPE_NA;
    }),
    "Temperature" : new TemperatureSetting(),
    "Humidity": new HumiditySetting()
}
