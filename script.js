// ======================================================
// VAJRA 2 - DUAL JOYSTICK CONTROLLER
// FIXED VERSION
// ======================================================

const BLE_NAME = "VAJRA2-FLIGHT";

const SERVICE_UUID =
  "12345678-1234-1234-1234-1234567890ab";

const COMMAND_UUID =
  "12345678-1234-1234-1234-1234567890ac";

const TELEMETRY_UUID =
  "12345678-1234-1234-1234-1234567890ad";


// ======================================================
// HELPER
// ======================================================

const $ = (id) => document.getElementById(id);


// ======================================================
// BLE VARIABLES
// ======================================================

let bleDevice = null;
let bleServer = null;
let commandCharacteristic = null;
let telemetryCharacteristic = null;

let sendTimer = null;
let lastCommand = "";


// ======================================================
// JOYSTICK VALUES
// ======================================================

const axes = {
  throttle: 0,
  yaw: 0,
  roll: 0,
  pitch: 0
};


// ======================================================
// CONNECTION UI
// ======================================================

function setConnection(connected, message = "") {

  $("statusDot").classList.toggle(
    "connected",
    connected
  );

  $("connectionStatus").textContent =
    connected ? "Connected" : "Disconnected";

  $("connectionHint").textContent =
    connected
      ? "Main ESP32-C3 BLE link active"
      : "Connect your Main ESP32-C3 in Settings";

  $("dataMode").textContent =
    connected ? "BLE LINK" : "WAITING";

  $("dataMode").classList.toggle(
    "live",
    connected
  );

  $("deviceName").textContent =
    connected && bleDevice
      ? (bleDevice.name || BLE_NAME)
      : "Not connected";

  $("dashboardMode").textContent =
    connected
      ? "Connected"
      : "Disconnected";

  $("connectQuick").disabled =
    connected;

  $("settingsConnect").disabled =
    connected;

  $("modalConnect").disabled =
    connected;

  $("disconnectButton").disabled =
    !connected;

  $("stopButton").disabled =
    !connected;

  $("commandStatus").textContent =
    message ||
    (
      connected
        ? "BLE connected."
        : "Commands are disabled until BLE is connected."
    );
}


// ======================================================
// SETTINGS
// ======================================================

function openSettings() {
  $("settingsModal").classList.remove("hidden");
}


function closeSettings() {
  $("settingsModal").classList.add("hidden");
}


// ======================================================
// BLE CONNECT
// ======================================================

async function connectBLE() {

  if (!navigator.bluetooth) {

    $("settingsMessage").textContent =
      "Web Bluetooth is not supported by this browser.";

    return;
  }


  try {

    $("settingsMessage").textContent =
      "Searching for VAJRA 2 Main ESP32-C3...";


    // Ask browser for ESP32

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


    // Connect

    bleServer =
      await bleDevice.gatt.connect();


    // Get service

    const service =
      await bleServer.getPrimaryService(
        SERVICE_UUID
      );


    // Command characteristic

    commandCharacteristic =
      await service.getCharacteristic(
        COMMAND_UUID
      );


    // Telemetry characteristic

    try {

      telemetryCharacteristic =
        await service.getCharacteristic(
          TELEMETRY_UUID
        );

      if (
        telemetryCharacteristic.properties.notify
      ) {

        telemetryCharacteristic.addEventListener(
          "characteristicvaluechanged",
          onTelemetry
        );

        await telemetryCharacteristic.startNotifications();

      }

    }

    catch (telemetryError) {

      console.log(
        "Telemetry characteristic unavailable:",
        telemetryError
      );

    }


    setConnection(
      true,
      "Connected to Main ESP32-C3."
    );


    $("settingsMessage").textContent =
      "VAJRA 2 connected successfully.";

    closeSettings();


    startCommandLoop();

  }

  catch (error) {

    console.error(
      "BLE ERROR:",
      error
    );


    $("settingsMessage").textContent =
      "Connection failed: " +
      error.message;


    setConnection(
      false,
      "BLE connection failed."
    );

  }

}


// ======================================================
// BLE DISCONNECT
// ======================================================

function onDisconnected() {

  stopCommandLoop();

  commandCharacteristic = null;

  telemetryCharacteristic = null;

  bleServer = null;

  bleDevice = null;


  centerJoysticks(false);


  setConnection(
    false,
    "BLE disconnected."
  );

}


// ======================================================
// MANUAL DISCONNECT
// ======================================================

function disconnectBLE() {

  stopCommandLoop();


  if (
    bleDevice &&
    bleDevice.gatt &&
    bleDevice.gatt.connected
  ) {

    bleDevice.gatt.disconnect();

  }

  else {

    onDisconnected();

  }

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


  const text =
    new TextDecoder()
      .decode(bytes)
      .trim();


  if (!text) {
    return;
  }


  $("lastMessage").textContent =
    text;


  /*
    Example:

    ROLL:1.25,PITCH:-2.10,YAW:0,BATTERY:11.8
  */


  const values = {};


  text
    .split(/[,\n;]/)
    .forEach(item => {

      const match =
        item.trim().match(
          /^([A-Za-z_]+)\s*:\s*(-?\d+(?:\.\d+)?)/
        );


      if (match) {

        values[
          match[1].toUpperCase()
        ] =
          Number(match[2]);

      }

    });


  if (
    Number.isFinite(values.ROLL)
  ) {

    $("rollData").textContent =
      values.ROLL.toFixed(1) + "°";

  }


  if (
    Number.isFinite(values.PITCH)
  ) {

    $("pitchData").textContent =
      values.PITCH.toFixed(1) + "°";

  }


  if (
    Number.isFinite(values.YAW)
  ) {

    $("yawData").textContent =
      values.YAW.toFixed(0);

  }


  if (
    Number.isFinite(values.BATTERY)
  ) {

    $("batteryData").textContent =
      values.BATTERY.toFixed(2) + " V";

  }


  $("dataMode").textContent =
    "LIVE DATA";

  $("dataMode").classList.add(
    "live"
  );

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
    Math.min(
      max,
      value
    )
  );

}


// ======================================================
// FIXED JOYSTICK SYSTEM
// ======================================================

function setupJoystick(
  knobId,
  side
) {

  // The HTML ID is on the knob.
  // The joystick ring is its parent.

  const knob =
    $(knobId);


  if (!knob) {

    console.error(
      "Joystick knob not found:",
      knobId
    );

    return;

  }


  const ring =
    knob.parentElement;


  if (!ring) {

    console.error(
      "Joystick ring not found:",
      knobId
    );

    return;

  }


  let pointerActive =
    false;


  // --------------------------------------------
  // MOVE JOYSTICK
  // --------------------------------------------

  function moveJoystick(event) {

    const rect =
      ring.getBoundingClientRect();


    const centerX =
      rect.left +
      rect.width / 2;


    const centerY =
      rect.top +
      rect.height / 2;


    // Maximum movement of knob

    const maxRadius =
      Math.min(
        rect.width,
        rect.height
      ) * 0.34;


    let dx =
      event.clientX -
      centerX;


    let dy =
      event.clientY -
      centerY;


    const distance =
      Math.sqrt(
        dx * dx +
        dy * dy
      );


    // Keep knob inside circle

    if (
      distance > maxRadius
    ) {

      dx =
        (dx / distance) *
        maxRadius;


      dy =
        (dy / distance) *
        maxRadius;

    }


    // Move visual knob

    knob.style.left =
      `calc(50% + ${dx}px)`;


    knob.style.top =
      `calc(50% + ${dy}px)`;


    // Normalized values

    const x =
      clamp(
        dx / maxRadius,
        -1,
        1
      );


    const y =
      clamp(
        -dy / maxRadius,
        -1,
        1
      );


    // --------------------------------------------
    // LEFT JOYSTICK
    // --------------------------------------------

    if (
      side === "left"
    ) {

      /*
        UP    = throttle increase
        DOWN  = throttle decrease

        LEFT  = yaw left
        RIGHT = yaw right
      */

      axes.throttle =
        Math.round(
          ((y + 1) / 2) * 100
        );


      axes.yaw =
        Math.round(
          x * 100
        );


      $("throttleValue")
        .textContent =
        axes.throttle + "%";


      $("yawValue")
        .textContent =
        axes.yaw;

    }


    // --------------------------------------------
    // RIGHT JOYSTICK
    // --------------------------------------------

    else {

      /*
        UP    = pitch forward
        DOWN  = pitch backward

        LEFT  = roll left
        RIGHT = roll right
      */

      axes.roll =
        Math.round(
          x * 100
        );


      axes.pitch =
        Math.round(
          y * 100
        );


      $("rollValue")
        .textContent =
        axes.roll;


      $("pitchValue")
        .textContent =
        axes.pitch;

    }

  }


  // --------------------------------------------
  // POINTER DOWN
  // --------------------------------------------

  ring.addEventListener(
    "pointerdown",
    event => {

      event.preventDefault();


      pointerActive = true;


      ring.setPointerCapture(
        event.pointerId
      );


      moveJoystick(event);

    }
  );


  // --------------------------------------------
  // POINTER MOVE
  // --------------------------------------------

  ring.addEventListener(
    "pointermove",
    event => {

      if (!pointerActive) {
        return;
      }


      event.preventDefault();


      moveJoystick(event);

    }
  );


  // --------------------------------------------
  // RELEASE
  // --------------------------------------------

  function releaseJoystick(event) {

    if (!pointerActive) {
      return;
    }


    pointerActive = false;


    try {

      ring.releasePointerCapture(
        event.pointerId
      );

    }

    catch (error) {

      // Pointer may already have been released.

    }


    // Return knob to center

    knob.style.left =
      "50%";


    knob.style.top =
      "50%";


    // Reset values

    if (
      side === "left"
    ) {

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


    // Send neutral command

    sendCommand(
      commandString()
    );

  }


  ring.addEventListener(
    "pointerup",
    releaseJoystick
  );


  ring.addEventListener(
    "pointercancel",
    releaseJoystick
  );

}


// ======================================================
// CENTER JOYSTICKS
// ======================================================

function centerJoysticks(
  send = true
) {

  const left =
    $("leftStick");


  const right =
    $("rightStick");


  if (left) {

    left.style.left =
      "50%";

    left.style.top =
      "50%";

  }


  if (right) {

    right.style.left =
      "50%";

    right.style.top =
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


  if (send) {

    sendCommand(
      "JOY,0,0,0,0"
    );

  }

}


// ======================================================
// COMMAND FORMAT
// ======================================================

function commandString() {

  return (
    "JOY," +
    axes.throttle +
    "," +
    axes.yaw +
    "," +
    axes.roll +
    "," +
    axes.pitch
  );

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


  const data =
    new TextEncoder().encode(
      command + "\n"
    );


  /*
    Queue writes so rapid joystick
    movement does not overload BLE.
  */

  window.vajraWriteQueue =
    window.vajraWriteQueue ||
    Promise.resolve();


  window.vajraWriteQueue =
    window.vajraWriteQueue
      .then(async () => {

        if (
          !commandCharacteristic
        ) {

          return;

        }


        if (
          commandCharacteristic.properties
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
      .catch(error => {

        console.error(
          "BLE write error:",
          error
        );

      });

}


// ======================================================
// COMMAND LOOP
// ======================================================

function startCommandLoop() {

  stopCommandLoop();


  sendTimer =
    setInterval(
      () => {

        if (
          !commandCharacteristic
        ) {

          return;

        }


        const command =
          commandString();


        if (
          command !== lastCommand
        ) {

          sendCommand(
            command
          );


          lastCommand =
            command;

        }

      },
      50
    );

}


// ======================================================
// STOP COMMAND LOOP
// ======================================================

function stopCommandLoop() {

  if (sendTimer) {

    clearInterval(
      sendTimer
    );

  }


  sendTimer = null;

  lastCommand = "";

}


// ======================================================
// EMERGENCY STOP
// ======================================================

function emergencyStop() {

  centerJoysticks(false);


  if (
    commandCharacteristic
  ) {

    sendCommand(
      "STOP"
    );

  }


  $("commandStatus").textContent =
    "STOP command sent to Main ESP32-C3.";

}


// ======================================================
// BUTTONS
// ======================================================

$("openSettings")
  .addEventListener(
    "click",
    openSettings
  );


$("settingsConnect")
  .addEventListener(
    "click",
    openSettings
  );


$("closeSettings")
  .addEventListener(
    "click",
    closeSettings
  );


$("modalConnect")
  .addEventListener(
    "click",
    connectBLE
  );


$("connectQuick")
  .addEventListener(
    "click",
    openSettings
  );


$("disconnectButton")
  .addEventListener(
    "click",
    disconnectBLE
  );


$("stopButton")
  .addEventListener(
    "click",
    emergencyStop
  );


$("centerButton")
  .addEventListener(
    "click",
    () => {
      centerJoysticks(true);
    }
  );


// ======================================================
// CLOSE MODAL WHEN CLICKING OUTSIDE
// ======================================================

$("settingsModal")
  .addEventListener(
    "click",
    event => {

      if (
        event.target ===
        $("settingsModal")
      ) {

        closeSettings();

      }

    }
  );


// ======================================================
// START JOYSTICKS
// ======================================================

setupJoystick(
  "leftStick",
  "left"
);


setupJoystick(
  "rightStick",
  "right"
);


// ======================================================
// INITIALIZE
// ======================================================

centerJoysticks(false);

setConnection(false);

console.log(
  "VAJRA 2 dual joystick controller ready."
);
