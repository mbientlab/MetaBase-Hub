# MetaBase App for MetaHub (in Javascript) by MBIENTLAB
MetaBase configures [MetaSensor](https://mbientlab.com/store/) boards to stream data to your MetaHub.  

[![Platforms](https://img.shields.io/badge/platform-linux%20%7C%20-lightgrey?style=flat)](https://github.com/mbientlab/MetaBase-Hub)
[![License](https://img.shields.io/cocoapods/l/MetaWear.svg?style=flat)](https://github.com/mbientlab/MetaBase-Hub)
[![Version](https://img.shields.io/badge/node-%3D%208.17.0-brightgreen?style=flat)](https://github.com/mbientlab/MetaBase-Hub)

# Config File
The primary way to configure the application is with a JSON config file which is passed to the app via the ``--config`` options.  Your config file must have at minimum the devices 
and sensors defined.

```bash
sudo npm start -- --config metabase-config.json
```

## Commands
The first config option to set is the ``command`` key which controls what the app will do.  You can choose from the following actions:  

Action   | Description
---------|------------------------------------------------------------------------------------
stream   | Stream data realtime to the host device, also graphs the data live
log      | Records data to the on-board flash memory, can download later with any MetaBase app
download | Retrieves the data from any board setup to record data with a MetaBase app  

```json
{
  "command": "stream"
}
```

## Devices
The ``devices`` key is an array that holds the mac addresses of the devices to use.  The array elements can either be a MAC address string or an object containing both the MAC 
address string and a user defined name identifying the device.

```json
{
  "devices": [        
    "D4:5E:82:E1:15:01",
    {"mac": "D5:7B:B9:7D:CE:0E", "name": "Demo Unit"}
  ]
}
```

In the above example, the ``D4:5E:82:E1:15:01`` mac address will have a default name assigned to it whereas the ``D5:7B:B9:7D:CE:0E`` will be referred to as "Demo Unit" in both  
the UI window and MetaCloud

## Sensors
The ``sensors`` key is an object that the app uses the configure and enable the various on-board  sensors.  Its keys are the names of the enabled sensors and the values contain the sensor 
configuration.  

Each sensors have their own configurable parameters, detailed in the below table:

Name                | Parameters                  | Example
--------------------|-----------------------------|-----------------------------------------
Accelerometer       | ``odr``, ``range``          | { "odr" : 100.0, "range": 2.0 }
Gyroscope           | ``odr``, ``range``          | { "odr" : 25.0, "range": 250.0 }
Magnetometer        | ``odr``                     | { "odr" : 25.0 }
Quaternion          | ``accRange``, ``gyroRange`` | { "accRange": 2.0, "gyroRange": 250.0 }
Euler Angles        | ``accRange``, ``gyroRange`` | { "accRange": 4.0, "gyroRange": 500.0 }
Linear Acceleration | ``accRange``, ``gyroRange`` | { "accRange": 8.0, "gyroRange": 1000.0 }
Gravity             | ``accRange``, ``gyroRange`` | { "accRange": 16.0, "gyroRange": 2000.0 }
Ambient Light       | ``odr``, ``gain``           | { "odr": 10.0, gain: 4 }
Pressure            | ``odr``                     | { "odr": 1.96 }
Temperature         | ``period``                  | { "period": 1800 }
Humidity            | ``period``                  | { "period": 3600 }

For example, to sample accelerometer (+/-4g @ 100Hz), gyro (+/-1000 deg/s @ 100Hz), and mag data (25Hz):  

```json
{
    "sensors": {
        "Accelerometer": {"odr" : 100.0, "range": 4.0},
        "Gyroscope": {"odr" : 100.0, "range": 1000.0},
        "Magnetometer": {"odr" : 25.0}
    }
}
```

For all sensors, the ``odr`` or ``period`` parameter must be set if applicable.  The app will select default values for the other parameters if not set by the user, and in the case where invalid 
values are selected, the closest valid value will be used instead.

### Units
Sampling frequency values are expressed in ``Hz`` except for temperature and humidity which express them in ``seconds``.  For example, the previous JSON snippet will set the 
sensors to sample at 100.0Hz, 100.0Hz, and 25.0Hz respectively.  However, the below JSON snippet will sample temperature and humidity at 30min and 1hr respectively (1800s / 3600s):  

```json
{
    "sensors": {
        "Temperature": {"period" : 1800.0 },
        "Humidity": {"period" : 3600.0 }
    }
}
```

Note that the ``period`` key is used in lieu of ``odr``.

## Resolution
The ``resolution`` key is optional and sets the windows' width and height for the real time graphs.  If not set, the application will automatically create windows 1/4th the 
screen resolution.

```json
{
    "resolution": {
        "width": 960,
        "height": 540
    }
}
```

# Command Line Options
All settings in the config file have equivalent command line options.  The ``--devices`` and ``--sensors`` flags are require and can be repeated for multiple devices and sensors respectively.  
All other flags are optional.

The table below maps JSON keys to their matching option:

| JSON Key   | Command Line                 | Required |
|------------|------------------------------|----------|
| command    | --command                    | N        |
| devices    | --device                     | Y        |
| sensors    | --sensor                     | Y        |
| resolution | --width, --height            | N        |

The JSON configuration from the previous section can equivalently expressed in the command line as follows:

```bash
sudo npm start -- --device D4:5E:82:E1:15:01 --device "D5:7B:B9:7D:CE:0E=Demo Unit" \
    --sensor Accelerometer='{"odr" : 100.0, "range": 4.0}' \
    --sensor Gyroscope='{"odr" : 100.0, "range": 1000.0}' \
    --sensor Magnetometer='{"odr" : 25.0}' \
    --width 960 --height 540 \
    --command stream
```

## Disable RealTime Graph
By default, the app will create a window for each connected board and graph the data in real time, one graph per stream.  The realtime graphs can consume a lot of resources 
so users can disable it by passing in the ``--no-graph`` option in the command line.

```bash
sudo npm start -- --config metabase-config.json --no--graph
```

This graph is only available when streaming the data.
