/* =====================================================
   VAJRA 2
   DUAL JOYSTICK + BLE CONTROLLER
===================================================== */


/* =====================================================
   BLE CONFIGURATION
===================================================== */

const BLE_NAME =
  "VAJRA2-FLIGHT";


const SERVICE_UUID =
  "12345678-1234-1234-1234-1234567890ab";


const COMMAND_UUID =
  "12345678-1234-1234-1234-1234567890ac";


const TELEMETRY_UUID =
  "12345678-1234-1234-1234-1234567890ad";


/* =====================================================
   SHORT DOM FUNCTION
===================================================== */

const $ = (id) =>
  document.getElementById(id);


/* =====================================================
   BLE VARIABLES
===================================================== */

let bleDevice = null;

let bleServer = null;

let commandCharacteristic = null;

let telemetryCharacteristic = null;

let sendTimer = null;

let lastCommand = "";

let writeQueue =
  Promise.resolve();


/* =====================================================
   JOYSTICK VALUES
===================================================== */

const axes = {

  throttle: 0,

  yaw: 0,

  roll: 0,

  pitch: 0

};


/* =====================================================
   LOGO FALLBACK
===================================================== */

function showLogoFallback() {

  const logo =
    $("vajraLogo");

  const fallback =
    $("logoFallback");


  if (logo) {

    logo.style.display =
      "none";

  }


  if (fallback) {

    fallback.classList.add(
      "show"
    );

  }

}


const vajraLogo =
  $("vajraLogo");


if (vajraLogo) {

  vajraLogo.addEventListener(
    "error",
    showLogoFallback
  );


  /*
     If the image has already failed
     before JavaScript loads.
  */

  if (
    vajraLogo.complete &&
    vajraLogo.naturalWidth === 0
  ) {

    showLogoFallback();

  }

}


/* =====================================================
   CONNECTION UI
===================================================== */

function setConnection(
  connected,
  message = ""
) {

  $("statusDot")
    .classList
    .toggle(
      "connected",
      connected
    );


  $("connectionStatus")
    .textContent =
    connected
      ? "Connected"
      : "Disconnected";


  $("connectionHint")
    .textContent =
    connected
      ? "Main ESP32-C3 BLE link active"
      : "Connect Main ESP32-C3";


  $("dataMode")
    .textContent =
    connected
      ? "BLE LINK"
      : "WAITING";


  $("dataMode")
    .classList
    .toggle(
      "live",
      connected
    );


  $("deviceName")
    .textContent =
    connected && bleDevice
      ? (
          bleDevice.name ||
          BLE_NAME
        )
      : "Not connected";


  $("connectQuick")
    .disabled =
    connected;


  $("settingsConnect")
    .disabled =
    connected;


  $("modalConnect")
    .disabled =
    connected;


  $("disconnectButton")
    .disabled =
    !connected;


  $("stopButton")
    .disabled =
    !connected;


  $("commandStatus")
    .textContent =
    message ||
    (
      connected
        ? "BLE connected."
        : "Commands disabled until BLE is connected."
    );

}


/* =====================================================
   SETTINGS MODAL
===================================================== */

function openSettings() {

  $("settingsModal")
    .classList
    .remove("hidden");

}


function closeSettings() {

  $("settingsModal")
    .classList
    .add("hidden");

}


/* =====================================================
   BLE CONNECT
===================================================== */

async function connectBLE() {

  if (
    !navigator.bluetooth
  ) {

    $("settingsMessage")
      .textContent =
      "Web Bluetooth is not supported. Use Chrome or Edge.";

    return;

  }


  try {

    $("settingsMessage")
      .textContent =
      "Searching for VAJRA2-FLIGHT...";


    bleDevice =
      await navigator.bluetooth
        .requestDevice({

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


    $("settingsMessage")
      .textContent =
      "Connecting to ESP32-C3...";


    bleServer =
      await bleDevice.gatt.connect();


    const service =
      await bleServer
        .getPrimaryService(
          SERVICE_UUID
        );


    commandCharacteristic =
      await service
        .getCharacteristic(
          COMMAND_UUID
        );


    /*
       Telemetry is optional.
    */

    try {

      telemetryCharacteristic =
        await service
          .getCharacteristic(
            TELEMETRY_UUID
          );


      if (
        telemetryCharacteristic
          .properties
          .notify
      ) {

        telemetryCharacteristic
          .addEventListener(
            "characteristicvaluechanged",
            onTelemetry
          );


        await telemetryCharacteristic
          .startNotifications();

      }

    }

    catch (error) {

      console.log(
        "Telemetry characteristic unavailable:",
        error
      );

    }


    setConnection(
      true,
      "Connected to Main ESP32-C3."
    );


    $("settingsMessage")
      .textContent =
      "VAJRA 2 connected successfully.";


    closeSettings();


    startCommandLoop();

  }

  catch (error) {

    console.error(
      "BLE error:",
      error
    );


    $("settingsMessage")
      .textContent =
      "Connection failed: " +
      error.message;


    setConnection(
      false,
      "BLE connection failed."
    );

  }

}


/* =====================================================
   DISCONNECT
===================================================== */

function onDisconnected() {

  stopCommandLoop();


  commandCharacteristic =
    null;


  telemetryCharacteristic =
    null;


  bleServer =
    null;


  bleDevice =
    null;


  centerJoysticks(
    false
  );


  setConnection(
    false,
    "BLE disconnected."
  );

}


/* =====================================================
   MANUAL DISCONNECT
===================================================== */

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


/* =====================================================
   TELEMETRY
===================================================== */

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


  $("lastMessage")
    .textContent =
    text;


  const values = {};


  text
    .split(/[,\n;]/)
    .forEach(
      item => {

        const match =
          item
            .trim()
            .match(
              /^([A-Za-z_]+)\s*:\s*(-?\d+(?:\.\d+)?)/
            );


        if (match) {

          values[
            match[1].toUpperCase()
          ] =
            Number(
              match[2]
            );

        }

      }
    );


  if (
    Number.isFinite(
      values.ROLL
    )
  ) {

    $("rollData")
      .textContent =
      values.ROLL.toFixed(1) +
      "°";

  }


  if (
    Number.isFinite(
      values.PITCH
    )
  ) {

    $("pitchData")
      .textContent =
      values.PITCH.toFixed(1) +
      "°";

  }


  if (
    Number.isFinite(
      values.YAW
    )
  ) {

    $("yawData")
      .textContent =
      values.YAW.toFixed(0);

  }


  if (
    Number.isFinite(
      values.BATTERY
    )
  ) {

    $("batteryData")
      .textContent =
      values.BATTERY.toFixed(2) +
      " V";

  }


  $("dataMode")
    .textContent =
    "LIVE DATA";


  $("dataMode")
    .classList
    .add("live");

}


/* =====================================================
   CLAMP
===================================================== */

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


/* =====================================================
   JOYSTICK
===================================================== */

function setupJoystick(
  knobId,
  ringId,
  side
) {

  const knob =
    $(knobId);

  const ring =
    $(ringId);


  if (
    !knob ||
    !ring
  ) {

    console.error(
      "Joystick elements missing."
    );

    return;

  }


  let active =
    false;


  function moveJoystick(
    event
  ) {

    const rect =
      ring.getBoundingClientRect();


    const centerX =
      rect.left +
      rect.width / 2;


    const centerY =
      rect.top +
      rect.height / 2;


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


    if (
      distance >
      maxRadius
    ) {

      dx =
        dx /
        distance *
        maxRadius;


      dy =
        dy /
        distance *
        maxRadius;

    }


    knob.style.left =
      `calc(50% + ${dx}px)`;


    knob.style.top =
      `calc(50% + ${dy}px)`;


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


    /*
       LEFT JOYSTICK

       X = YAW
       Y = THROTTLE
    */

    if (
      side === "left"
    ) {

      axes.throttle =
        Math.round(
          ((y + 1) / 2) *
          100
        );


      axes.yaw =
        Math.round(
          x * 100
        );


      $("throttleValue")
        .textContent =
        axes.throttle +
        "%";


      $("yawValue")
        .textContent =
        axes.yaw;

    }


    /*
       RIGHT JOYSTICK

       X = ROLL
       Y = PITCH
    */

    else {

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


  ring.addEventListener(
    "pointerdown",
    event => {

      event.preventDefault();

      active =
        true;


      try {

        ring.setPointerCapture(
          event.pointerId
        );

      }

      catch (error) {

      }


      moveJoystick(
        event
      );

    }
  );


  ring.addEventListener(
    "pointermove",
    event => {

      if (!active) {

        return;

      }


      event.preventDefault();


      moveJoystick(
        event
      );

    }
  );


  function release(
    event
  ) {

    if (!active) {

      return;

    }


    active =
      false;


    try {

      ring.releasePointerCapture(
        event.pointerId
      );

    }

    catch (error) {

    }


    knob.style.left =
      "50%";


    knob.style.top =
      "50%";


    if (
      side === "left"
    ) {

      axes.throttle =
        0;

      axes.yaw =
        0;


      $("throttleValue")
        .textContent =
        "0%";


      $("yawValue")
        .textContent =
        "0";

    }

    else {

      axes.roll =
        0;

      axes.pitch =
        0;


      $("rollValue")
        .textContent =
        "0";


      $("pitchValue")
        .textContent =
        "0";

    }


    sendCommand(
      commandString()
    );

  }


  ring.addEventListener(
    "pointerup",
    release
  );


  ring.addEventListener(
    "pointercancel",
    release
  );

}


/* =====================================================
   CENTER JOYSTICKS
===================================================== */

function centerJoysticks(
  send = true
) {

  $("leftStick").style.left =
    "50%";


  $("leftStick").style.top =
    "50%";


  $("rightStick").style.left =
    "50%";


  $("rightStick").style.top =
    "50%";


  axes.throttle =
    0;

  axes.yaw =
    0;

  axes.roll =
    0;

  axes.pitch =
    0;


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


/* =====================================================
   COMMAND FORMAT
===================================================== */

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


/* =====================================================
   SEND BLE COMMAND
===================================================== */

function sendCommand(
  command
) {

  if (
    !commandCharacteristic
  ) {

    return;

  }


  const data =
    new TextEncoder()
      .encode(
        command + "\n"
      );


  writeQueue =
    writeQueue.then(
      async () => {

        if (
          !commandCharacteristic
        ) {

          return;

        }


        try {

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

        }

        catch (error) {

          console.error(
            "BLE write failed:",
            error
          );

        }

      }
    );

}


/* =====================================================
   COMMAND LOOP
===================================================== */

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


        /*
           Send continuously while joystick
           is being used.
        */

        if (
          command !==
          lastCommand
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


/* =====================================================
   STOP COMMAND LOOP
===================================================== */

function stopCommandLoop() {

  if (sendTimer) {

    clearInterval(
      sendTimer
    );

  }


  sendTimer =
    null;


  lastCommand =
    "";

}


/* =====================================================
   EMERGENCY STOP
===================================================== */

function emergencyStop() {

  centerJoysticks(
    false
  );


  if (
    commandCharacteristic
  ) {

    sendCommand(
      "STOP"
    );

  }


  $("commandStatus")
    .textContent =
    "STOP command sent.";

}


/* =====================================================
   BUTTONS
===================================================== */

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

      centerJoysticks(
        true
      );

    }
  );


/* =====================================================
   CLOSE MODAL BY CLICKING OUTSIDE
===================================================== */

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


/* =====================================================
   INITIALIZE JOYSTICKS
===================================================== */

setupJoystick(
  "leftStick",
  "leftRing",
  "left"
);


setupJoystick(
  "rightStick",
  "rightRing",
  "right"
);


centerJoysticks(
  false
);


setConnection(
  false
);


console.log(
  "VAJRA 2 controller ready."
);
