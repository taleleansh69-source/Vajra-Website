// ======================================================
// VAJRA 2
// DUAL JOYSTICK + BLE MAIN ESP32-C3 CONTROL
// ======================================================


// ======================================================
// BLE SETTINGS
// ======================================================

// These MUST match the BLE firmware running on
// your Main ESP32-C3.

const BLE_NAME = "VAJRA2-FLIGHT";

const SERVICE_UUID =
  "12345678-1234-1234-1234-1234567890ab";

const COMMAND_UUID =
  "12345678-1234-1234-1234-1234567890ac";

const TELEMETRY_UUID =
  "12345678-1234-1234-1234-1234567890ad";


// ======================================================
// SHORT DOM FUNCTION
// ======================================================

const $ = (id) => document.getElementById(id);


// ======================================================
// UI ELEMENTS
// ======================================================

const ui = {

  statusDot:
    $("statusDot"),

  connectionStatus:
    $("connectionStatus"),

  connectionHint:
    $("connectionHint"),

  dataMode:
    $("dataMode"),

  deviceName:
    $("deviceName"),

  dashboardMode:
    $("dashboardMode"),

  commandStatus:
    $("commandStatus"),

  settingsMessage:
    $("settingsMessage"),

  connectQuick:
    $("connectQuick"),

  settingsConnect:
    $("settingsConnect"),

  modalConnect:
    $("modalConnect"),

  disconnectButton:
    $("disconnectButton"),

  stopButton:
    $("stopButton"),

  settingsModal:
    $("settingsModal")
};


// ======================================================
// BLE VARIABLES
// ======================================================

let bleDevice = null;

let server = null;

let commandCharacteristic = null;

let telemetryCharacteristic = null;


// ======================================================
// COMMAND VARIABLES
// ======================================================

let lastSent = "";

let sendTimer = null;

let writeQueue = Promise.resolve();


// ======================================================
// JOYSTICK VALUES
// ======================================================

// throttle = 0 to 100
// yaw      = -100 to +100
// roll     = -100 to +100
// pitch    = -100 to +100

const axes = {

  throttle: 0,

  yaw: 0,

  roll: 0,

  pitch: 0

};


const activePointers = new Map();


// ======================================================
// CONNECTION STATUS
// ======================================================

function setConnection(
  connected,
  message = ""
) {

  ui.statusDot.classList.toggle(
    "connected",
    connected
  );


  ui.connectionStatus.textContent =
    connected
      ? "Connected"
      : "Disconnected";


  ui.connectionHint.textContent =
    connected
      ? "Main ESP32-C3 BLE link active"
      : "Connect your Main ESP32-C3 in Settings";


  ui.dataMode.textContent =
    connected
      ? "BLE LINK"
      : "WAITING";


  ui.dataMode.classList.toggle(
    "live",
    connected
  );


  ui.deviceName.textContent =
    connected && bleDevice
      ? (
          bleDevice.name ||
          BLE_NAME
        )
      : "Not connected";


  ui.dashboardMode.textContent =
    connected
      ? "Connected / awaiting data"
      : "Disconnected";


  ui.connectQuick.disabled =
    connected;


  ui.settingsConnect.disabled =
    connected;


  ui.modalConnect.disabled =
    connected;


  ui.disconnectButton.disabled =
    !connected;


  ui.stopButton.disabled =
    !connected;


  ui.commandStatus.textContent =
    message ||
    (
      connected
        ? "BLE connected. Joystick commands can be sent; flight firmware must safely handle them."
        : "Commands are disabled until BLE is connected."
    );
}


// ======================================================
// SETTINGS WINDOW
// ======================================================

function openSettings() {

  ui.settingsModal.classList.remove(
    "hidden"
  );

}


function closeSettings() {

  ui.settingsModal.classList.add(
    "hidden"
  );

}


// ======================================================
// BLE CONNECTION
// ======================================================

async function connectBLE() {

  if (!("bluetooth" in navigator)) {

    ui.settingsMessage.textContent =
      "Web Bluetooth is not available in this browser. Try Chrome or Edge on HTTPS or localhost.";

    return;
  }


  try {

    ui.settingsMessage.textContent =
      "Choose the VAJRA 2 Main ESP32-C3 device in the browser picker…";


    // Open Bluetooth device picker

    bleDevice =
      await navigator.bluetooth.requestDevice({

        filters: [
          {
            name: BLE_NAME
          }
        ],

        optionalServices: [
          SERVICE_UUID
        ]

      });


    bleDevice.addEventListener(
      "gattserverdisconnected",
      onDisconnected
    );


    // Connect to ESP32 BLE GATT server

    server =
      await bleDevice.gatt.connect();


    // Get BLE service

    const service =
      await server.getPrimaryService(
        SERVICE_UUID
      );


    // Command characteristic

    commandCharacteristic =
      await service.getCharacteristic(
        COMMAND_UUID
      );


    // Telemetry characteristic

    telemetryCharacteristic =
      await service.getCharacteristic(
        TELEMETRY_UUID
      );


    // Start telemetry notifications

    if (
      telemetryCharacteristic.properties.notify
    ) {

      telemetryCharacteristic.addEventListener(
        "characteristicvaluechanged",
        onTelemetry
      );


      await telemetryCharacteristic.startNotifications();

    }


    setConnection(
      true,
      "Connected to Main ESP32-C3. Keep propellers removed during testing."
    );


    ui.settingsMessage.textContent =
      "Connected. Confirm the flight board firmware safely supports the JOY command before attempting any motor control.";


    closeSettings();


    startSending();

  }

  catch (err) {

    console.error(err);


    ui.settingsMessage.textContent =
      `Connection failed: ${
        err.message || err
      }. Check board power, BLE name, UUIDs, and browser permissions.`;


    setConnection(
      false,
      "BLE connection failed. Check Settings for details."
    );

  }

}


// ======================================================
// BLE DISCONNECTED
// ======================================================

function onDisconnected() {

  stopSending();

  commandCharacteristic = null;

  telemetryCharacteristic = null;

  server = null;

  bleDevice = null;


  centerSticks(false);


  setConnection(
    false,
    "BLE disconnected. Joystick commands stopped."
  );


  ui.settingsMessage.textContent =
    "Disconnected. Reconnect from Settings when ready.";

}


// ======================================================
// MANUAL DISCONNECT
// ======================================================

async function disconnectBLE() {

  stopSending();


  try {

    if (
      bleDevice &&
      bleDevice.gatt &&
      bleDevice.gatt.connected
    ) {

      bleDevice.gatt.disconnect();

    }

  }

  catch (err) {

    console.warn(err);

  }


  onDisconnected();

}


// ======================================================
// TELEMETRY
// ======================================================

function onTelemetry(event) {

  const value =
    event.target.value;


  const bytes =
    new Uint8Array(
      value.buffer,
      value.byteOffset,
      value.byteLength
    );


  const telemetryText =
    new TextDecoder()
      .decode(bytes)
      .trim();


  $("lastMessage").textContent =
    telemetryText ||
    "Empty telemetry message";


  /*
    Expected examples:

    ROLL:1.2,
    PITCH:-0.5,
    YAW:0,
    BATTERY:11.4
  */


  const fields = {};


  telemetryText
    .split(/[;,\n]/)
    .forEach(part => {

      const match =
        part
          .trim()
          .match(
            /^([A-Z_]+)\s*:\s*(-?\d+(?:\.\d+)?)/i
          );


      if (match) {

        fields[
          match[1].toUpperCase()
        ] =
          Number(match[2]);

      }

    });


  // Roll

  if (
    Number.isFinite(fields.ROLL)
  ) {

    $("rollData").textContent =
      fields.ROLL.toFixed(1) + "°";

  }


  // Pitch

  if (
    Number.isFinite(fields.PITCH)
  ) {

    $("pitchData").textContent =
      fields.PITCH.toFixed(1) + "°";

  }


  // Yaw

  if (
    Number.isFinite(fields.YAW)
  ) {

    $("yawData").textContent =
      fields.YAW.toFixed(0);

  }


  // Battery

  if (
    Number.isFinite(fields.BATTERY)
  ) {

    $("batteryData").textContent =
      fields.BATTERY.toFixed(2) + " V";

  }


  ui.dataMode.textContent =
    "LIVE DATA";


  ui.dashboardMode.textContent =
    "Connected / live telemetry";

}


// ======================================================
// CLAMP
// ======================================================

function clamp(
  value,
  min,
  max
) {

  return Math.max(
    min,
    Math.min(max, value)
  );

}


// ======================================================
// CALCULATE JOYSTICK POSITION
// ======================================================

function stickValues(
  element,
  event
) {

  const rect =
    element.getBoundingClientRect();


  const radius =
    Math.min(
      rect.width,
      rect.height
    ) * 0.34;


  const centerX =
    rect.left +
    rect.width / 2;


  const centerY =
    rect.top +
    rect.height / 2;


  let dx =
    event.clientX -
    centerX;


  let dy =
    event.clientY -
    centerY;


  const length =
    Math.hypot(dx, dy);


  if (length > radius) {

    dx =
      dx / length *
      radius;


    dy =
      dy / length *
      radius;

  }


  return {

    x: dx / radius,

    y: -dy / radius,

    px: dx,

    py: dy

  };

}


// ======================================================
// SETUP JOYSTICK
// ======================================================

function setupStick(
  id,
  side
) {

  const ring =
    $(id);


  const knob =
    ring.querySelector(".stick");


  function move(event) {

    const v =
      stickValues(
        ring,
        event
      );


    knob.style.left =
      `calc(50% + ${v.px}px)`;


    knob.style.top =
      `calc(50% + ${v.py}px)`;


    // ----------------------------------
    // LEFT JOYSTICK
    // ----------------------------------

    if (side === "left") {

      // Vertical = throttle

      axes.throttle =
        Math.round(
          clamp(
            (v.y + 1) * 50,
            0,
            100
          )
        );


      // Horizontal = yaw

      axes.yaw =
        Math.round(
          v.x * 100
        );


      $("throttleValue")
        .textContent =
        axes.throttle + "%";


      $("yawValue")
        .textContent =
        String(
          axes.yaw
        );

    }


    // ----------------------------------
    // RIGHT JOYSTICK
    // ----------------------------------

    else {

      // Horizontal = roll

      axes.roll =
        Math.round(
          v.x * 100
        );


      // Vertical = pitch

      axes.pitch =
        Math.round(
          v.y * 100
        );


      $("rollValue")
        .textContent =
        String(
          axes.roll
        );


      $("pitchValue")
        .textContent =
        String(
          axes.pitch
        );

    }

  }


  // Pointer DOWN

  ring.addEventListener(
    "pointerdown",
    event => {

      event.preventDefault();


      ring.setPointerCapture(
        event.pointerId
      );


      activePointers.set(
        event.pointerId,
        side
      );


      move(event);

    }
  );


  // Pointer MOVE

  ring.addEventListener(
    "pointermove",
    event => {

      if (
        activePointers.has(
          event.pointerId
        )
      ) {

        move(event);

      }

    }
  );


  // Pointer RELEASE

  const release =
    event => {

      if (
        !activePointers.has(
          event.pointerId
        )
      ) {

        return;

      }


      activePointers.delete(
        event.pointerId
      );


      knob.style.left =
        "50%";


      knob.style.top =
        "50%";


      if (side === "left") {

        axes.throttle = 0;

        axes.yaw = 0;


        $("throttleValue")
          .textContent =
          "0%";


        $("yawValue")
          .textContent =
          "0";

      }

      else {

        axes.roll = 0;

        axes.pitch = 0;


        $("rollValue")
          .textContent =
          "0";


        $("pitchValue")
          .textContent =
          "0";

      }

    };


  ring.addEventListener(
    "pointerup",
    release
  );


  ring.addEventListener(
    "pointercancel",
    release
  );


  ring.addEventListener(
    "lostpointercapture",
    release
  );

}


// ======================================================
// CENTER BOTH JOYSTICKS
// ======================================================

function centerSticks(
  sendNow = true
) {

  activePointers.clear();


  for (
    const id of [
      "leftStick",
      "rightStick"
    ]
  ) {

    const ring =
      $(id);


    const knob =
      ring.querySelector(
        ".stick"
      );


    knob.style.left =
      "50%";


    knob.style.top =
      "50%";

  }


  axes.throttle = 0;

  axes.yaw = 0;

  axes.roll = 0;

  axes.pitch = 0;


  $("throttleValue")
    .textContent =
    "0%";


  $("yawValue")
    .textContent =
    "0";


  $("rollValue")
    .textContent =
    "0";


  $("pitchValue")
    .textContent =
    "0";


  if (
    sendNow &&
    commandCharacteristic
  ) {

    sendCommand(
      "JOY,0,0,0,0"
    );

  }

}


// ======================================================
// CREATE JOYSTICK COMMAND
// ======================================================

function commandString() {

  /*
    Protocol:

    JOY,
    throttle 0..100,
    yaw -100..100,
    roll -100..100,
    pitch -100..100

    Example:

    JOY,50,0,0,0
  */


  return `JOY,${axes.throttle},${axes.yaw},${axes.roll},${axes.pitch}`;

}


// ======================================================
// SEND BLE COMMAND
// ======================================================

function sendCommand(
  command
) {

  if (
    !commandCharacteristic
  ) {

    return;

  }


  const text =
    command + "\n";


  /*
    Queue BLE writes.

    This prevents multiple GATT
    writes from happening at exactly
    the same time when the joystick
    moves quickly.
  */

  writeQueue =
    writeQueue
      .then(async () => {

        if (
          !commandCharacteristic
        ) {

          return;

        }


        const data =
          new TextEncoder()
            .encode(text);


        if (
          commandCharacteristic
            .properties
            .writeWithoutResponse &&
          commandCharacteristic
            .writeValueWithoutResponse
        ) {

          await commandCharacteristic
            .writeValueWithoutResponse(
              data
            );

        }

        else {

          await commandCharacteristic
            .writeValue(
              data
            );

        }

      })

      .catch(err => {

        console.error(
          "BLE command write failed:",
          err
        );


        ui.commandStatus.textContent =
          "Command write failed. Disconnect and check the Main board.";

      });

}


// ======================================================
// START COMMAND TRANSMISSION
// ======================================================

function startSending() {

  stopSending();


  lastSent = "";


  sendTimer =
    setInterval(() => {

      if (
        !commandCharacteristic
      ) {

        return;

      }


      const command =
        commandString();


      /*
        Only send when the command
        changes.
      */

      if (
        command !== lastSent
      ) {

        sendCommand(
          command
        );


        lastSent =
          command;

      }

    }, 100);

}


// ======================================================
// STOP COMMAND TRANSMISSION
// ======================================================

function stopSending() {

  if (sendTimer) {

    clearInterval(
      sendTimer
    );

  }


  sendTimer = null;

  lastSent = "";

}


// ======================================================
// EMERGENCY STOP
// ======================================================

async function emergencyStop() {

  centerSticks(false);


  if (
    commandCharacteristic
  ) {

    sendCommand(
      "STOP"
    );

  }


  ui.commandStatus.textContent =
    "STOP command sent to Main ESP32-C3. This is not a substitute for a hardware failsafe.";

}


// ======================================================
// BUTTON EVENTS
// ======================================================

$("openSettings")
  .addEventListener(
    "click",
    openSettings
  );


ui.settingsConnect
  .addEventListener(
    "click",
    openSettings
  );


$("closeSettings")
  .addEventListener(
    "click",
    closeSettings
  );


ui.modalConnect
  .addEventListener(
    "click",
    connectBLE
  );


ui.connectQuick
  .addEventListener(
    "click",
    () => {

      openSettings();

    }
  );


ui.disconnectButton
  .addEventListener(
    "click",
    disconnectBLE
  );


ui.stopButton
  .addEventListener(
    "click",
    emergencyStop
  );


$("centerButton")
  .addEventListener(
    "click",
    () => {

      centerSticks(true);

    }
  );


// ======================================================
// CLOSE SETTINGS WHEN CLICKING OUTSIDE
// ======================================================

ui.settingsModal
  .addEventListener(
    "click",
    event => {

      if (
        event.target ===
        ui.settingsModal
      ) {

        closeSettings();

      }

    }
  );


// ======================================================
// INITIALIZE JOYSTICKS
// ======================================================

setupStick(
  "leftStick",
  "left"
);


setupStick(
  "rightStick",
  "right"
);


// ======================================================
// INITIAL STATE
// ======================================================

setConnection(false);
