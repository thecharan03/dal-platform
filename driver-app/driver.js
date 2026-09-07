const CONFIG = {
  API_BASE:
    localStorage.getItem("DAL_API_URL") ||
    "https://dal-platform.onrender.com",
  REFRESH_INTERVAL: 5000,
  GPS_SEND_INTERVAL: 5000,
  GPS_OPTIONS: {
    enableHighAccuracy: true,
    maximumAge: 3000,
    timeout: 15000
  },
  MAP: {
    defaultCenter: [20.5937, 78.9629],
    defaultZoom: 5
  }
};

/* =========================================================
APPLICATION STATE
========================================================= */

const state = {
  map: null,
  driver: null,
  vehicle: null,
  shipment: null,
  drivers: [],
  routes: [],
  selectedRoute: null,
  vehicleMarker: null,
  originMarker: null,
  destinationMarker: null,
  routeLayers: [],
  selectedRouteLayer: null,
  gpsWatchId: null,
  lastGpsSentAt: 0,
  currentPosition: null,
  previousPosition: null,
  navigationStarted: false,
  followingVehicle: true,
  lastIntelligence: null,
  refreshTimer: null,
  reroutePending: false,
  connected: false
};

/* =========================================================
DOM HELPERS
========================================================= */

const $ = (id) => document.getElementById(id);

function setText(id, value) {
  const element = $(id);
  if (element) {
    element.textContent =
      value === null ||
      value === undefined ||
      value === ""
        ? "--"
        : value;
  }
}

function show(id) {
  const element = $(id);
  if (element) {
    element.classList.remove("hidden");
  }
}

function hide(id) {
  const element = $(id);
  if (element) {
    element.classList.add("hidden");
  }
}

/* =========================================================
NUMBER HELPERS
========================================================= */

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

function clamp(value, min, max) {
  return Math.min(
    Math.max(value, min),
    max
  );
}

/* =========================================================
API
========================================================= */

async function api(path, options = {}) {
  const url =
    `${CONFIG.API_BASE}${path}`;

  const response =
    await fetch(url, {
      ...options,

      headers: {
        "Content-Type":
          "application/json",

        ...(options.headers || {})
      }
    });

  let data = null;
  const contentType =
    response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  if (!response.ok) {
    const message =
      typeof data === "string"
        ? data
        : extractApiError(data);

    throw new Error(
      message ||
      `API error ${response.status}`
    );
  }

  return data;
}

function extractApiError(data) {
  if (!data) {
    return "";
  }

  if (typeof data === "string") {
    return data;
  }

  if (data.detail) {
    if (Array.isArray(data.detail)) {
      return data.detail
        .map(item =>
          item.msg ||
          JSON.stringify(item)
        )
        .join(", ");
    }

    return String(data.detail);
  }

  if (data.message) {
    return String(data.message);
  }

  return "";
}

/* =========================================================
CONNECTION STATE
========================================================= */

function setConnection(status, text) {
  const element =
    $("connectionStatus");

  const label =
    $("connectionText");

  if (!element) {
    return;
  }

  element.classList.remove(
    "connected",
    "error"
  );

  if (status === "connected") {
    element.classList.add("connected");
  }

  if (status === "error") {
    element.classList.add("error");
  }

  if (label) {
    label.textContent = text;
  }

  state.connected =
    status === "connected";
}

/* =========================================================
INITIALIZATION
========================================================= */

document.addEventListener(
  "DOMContentLoaded",
  init
);

async function init() {
  initializeMap();
  bindEvents();

  setConnection(
    "connecting",
    "Connecting..."
  );

  try {
    await loadDriverData();

    if (!state.driver) {
      setConnection(
        "connected",
        "Select Driver"
      );

      return;
    }

    showDriverApplication();

    setConnection(
      "connected",
      "Backend Connected"
    );

    await refreshIntelligence();

    startAutoRefresh();
  } catch (error) {
    console.error(error);

    setConnection(
      "error",
      "Backend Offline"
    );

    showInitialError(
      error.message
    );
  }
}

/* =========================================================
DRIVER APPLICATION VISIBILITY
========================================================= */

function showDriverApplication() {
  hide(
    "driverSelectionScreen"
  );

  show(
    "driverApplication"
  );

  setTimeout(
    () => {
      state.map?.invalidateSize();
    },
    100
  );
}

/* =========================================================
MAP INITIALIZATION
========================================================= */

function initializeMap() {
  state.map =
    L.map("map", {
      zoomControl: true,

      preferCanvas: true,

      attributionControl: true
    }).setView(
      CONFIG.MAP.defaultCenter,
      CONFIG.MAP.defaultZoom
    );

  L.tileLayer(
    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    {
      maxZoom: 19,

      attribution:
        '&copy; OpenStreetMap contributors'
    }
  ).addTo(state.map);

  state.map.on(
    "dragstart",
    () => {
      state.followingVehicle = false;

      $("followButton")
        ?.classList.remove("active");
    }
  );
}

/* =========================================================
BUTTON EVENTS
========================================================= */

function bindEvents() {
  $("registerDriverButton")?.addEventListener(
    "click",
    handleDriverRegistration
  );

  $("logoutButton")?.addEventListener(
    "click",
    logoutDriver
  );

  $("startNavigationButton")
    ?.addEventListener(
      "click",
      startNavigation
    );

  $("stopNavigationButton")
    ?.addEventListener(
      "click",
      stopNavigation
    );

  $("recenterButton")
    ?.addEventListener(
      "click",
      centerOnVehicle
    );

  $("followButton")
    ?.addEventListener(
      "click",
      toggleFollow
    );

  $("deliverButton")
    ?.addEventListener(
      "click",
      markDelivered
    );

  $("acceptRerouteButton")
    ?.addEventListener(
      "click",
      acceptReroute
    );

  $("keepRouteButton")
    ?.addEventListener(
      "click",
      keepCurrentRoute
    );

  $("closeDeliveryButton")
    ?.addEventListener(
      "click",
      () => {
        hide("deliveryModal");
      }
    );

  $("driverSelect")
    ?.addEventListener(
      "change",
      updateDriverSelectionButton
    );

  $("continueDriverButton")
    ?.addEventListener(
      "click",
      handleDriverSelection
    );
}

/* =========================================================
LOAD DRIVER DATA
========================================================= */

async function loadDriverData() {
  const [
    driversResponse,
    vehiclesResponse,
    shipmentsResponse
  ] = await Promise.all([
    api("/api/v1/drivers/"),
    api("/api/v1/vehicles"),
    api("/api/v1/shipments")
  ]);

  const drivers =
    normalizeCollection(
      driversResponse
    );

  const vehicles =
    normalizeCollection(
      vehiclesResponse
    );

  const shipments =
    normalizeCollection(
      shipmentsResponse
    );

  state.drivers =
    drivers;

  const driver =
    findRequestedDriver(
      drivers
    );

  if (!driver) {
    renderDriverSelector(
      drivers
    );

    return;
  }

  state.driver =
    driver;

  localStorage.setItem(
    "DAL_DRIVER_ID",
    driver.id
  );

  state.vehicle =
    findDriverVehicle(
      driver,
      vehicles
    );

  state.shipment =
    findAssignedShipment(
      shipments,
      state.vehicle
    );

  renderDriver();

  if (!state.vehicle) {
    renderNoVehicle();

    return;
  }

  renderVehicle();

  if (!state.shipment) {
    renderVehicleOnly();

    return;
  }

  renderShipment();

  renderShipmentMarkers();
}

/* =========================================================
DRIVER SELECTION
========================================================= */

function findRequestedDriver(
  drivers
) {
  if (!drivers.length) {
    return null;
  }

  const params =
    new URLSearchParams(
      window.location.search
    );

  const requestedDriverId =
    params.get("driver_id");

  if (requestedDriverId) {
    const requested =
      drivers.find(
        driver =>
          String(driver.id) ===
          String(requestedDriverId)
      );

    if (requested) {
      return requested;
    }
  }

  const savedDriverId =
    localStorage.getItem(
      "DAL_DRIVER_ID"
    );

  if (savedDriverId) {
    const saved =
      drivers.find(
        driver =>
          String(driver.id) ===
          String(savedDriverId)
      );

    if (saved) {
      return saved;
    }
  }

  return null;
}

/* =========================================================
DRIVER SELECTOR
========================================================= */

function renderDriverSelector(
  drivers
) {
  show("driverSelectionScreen");
  hide("driverApplication");

  const select = $("driverSelect");
  const button = $("continueDriverButton");
  const message = $("driverSelectionMessage");
  const registerButton = $("registerDriverButton");

  if (select) {
    select.disabled = drivers.length === 0;
    select.innerHTML = drivers.length
      ? `
        <option value="">Select driver...</option>
        ${drivers.map(driver => `
          <option value="${escapeHtml(String(driver.id))}">
            ${escapeHtml(driver.name || "Unnamed Driver")}
          </option>
        `).join("")}
      `
      : `<option value="">No registered drivers</option>`;
  }

  if (button) {
    button.disabled = true;
  }

  if (registerButton) {
    registerButton.classList.remove("hidden");
  }

  if (message) {
    message.textContent = drivers.length
      ? `${drivers.length} driver${drivers.length === 1 ? "" : "s"} available. Select your driver or register a new one.`
      : "No drivers registered yet. Register your driver to continue.";
  }
}


/* =========================================================
DRIVER SELF-REGISTRATION
========================================================= */

function renderDriverRegistrationForm() {
  const card = document.querySelector(".driver-selection-card");

  if (!card) {
    return;
  }

  card.innerHTML = `
    <div class="driver-selection-icon">🚚</div>

    <span class="eyebrow">DAL DRIVER PORTAL</span>

    <h1>Driver Registration</h1>

    <p>Enter your driver and vehicle details to register with DAL.</p>

    <div style="display:grid;gap:10px;text-align:left;width:100%;">
      <label for="registerDriverName">Driver Name</label>
      <input id="registerDriverName" type="text" placeholder="Enter your full name" autocomplete="name" />

      <label for="registerDriverPhone">Phone Number</label>
      <input id="registerDriverPhone" type="tel" placeholder="Enter phone number" autocomplete="tel" inputmode="tel" />

      <label for="registerDriverLicense">License Number</label>
      <input id="registerDriverLicense" type="text" placeholder="Enter license number" autocomplete="off" />

      <label for="registerVehicleNumber">Vehicle Number</label>
      <input id="registerVehicleNumber" type="text" placeholder="Example: NEXORA-02" autocomplete="off" />

      <label for="registerVehicleCapacity">Vehicle Capacity (kg)</label>
      <input id="registerVehicleCapacity" type="number" min="1" step="1" placeholder="Example: 5000" inputmode="numeric" />
    </div>

    <button class="primary-button" id="registerDriverButton" type="button">Register & Continue</button>

    <button class="secondary-button" id="backToDriverSelectionButton" type="button">← Back to Driver Selection</button>

    <div class="driver-selection-message" id="driverRegistrationMessage">Your driver and vehicle will be registered in DAL.</div>
  `;

  $("registerDriverButton")?.addEventListener(
    "click",
    handleDriverRegistration
  );

  $("backToDriverSelectionButton")?.addEventListener(
    "click",
    () => {
      renderDriverSelector(state.drivers);
    }
  );
}


async function handleDriverRegistration() {
  const name = $("registerDriverName")?.value.trim();
  const phone = $("registerDriverPhone")?.value.trim();
  const licenseNumber = $("registerDriverLicense")?.value.trim();
  const vehicleNumber = $("registerVehicleNumber")?.value.trim();
  const capacity = Number(
    $("registerVehicleCapacity")?.value
  );
  const button = $("registerDriverButton");
  const message = $("driverRegistrationMessage");

  if (!name) {
    if (message) message.textContent = "Please enter your name.";
    return;
  }

  if (!vehicleNumber) {
    if (message) message.textContent = "Please enter your vehicle number.";
    return;
  }

  if (phone && !/^[0-9+()\s-]{7,20}$/.test(phone)) {
    if (message) message.textContent = "Please enter a valid phone number.";
    return;
  }

  if (!Number.isFinite(capacity) || capacity <= 0) {
    if (message) message.textContent = "Please enter a valid vehicle capacity.";
    return;
  }

  if (button) {
    button.disabled = true;
    button.textContent = "Registering...";
  }

  if (message) {
    message.textContent = "Registering your vehicle and driver...";
  }

  try {
    const vehiclesResponse =
      await api("/api/v1/vehicles/");

    const vehicles =
      normalizeCollection(vehiclesResponse);

    let vehicle =
      vehicles.find(
        item =>
          String(item.vehicle_number || "")
            .trim()
            .toLowerCase() ===
          vehicleNumber.toLowerCase()
      ) || null;

    if (!vehicle) {
      vehicle = await api(
        "/api/v1/vehicles/create",
        {
          method: "POST",
          body: JSON.stringify({
            vehicle_number: vehicleNumber,
            capacity_kg: capacity
          })
        }
      );
    } else {
      const existingCapacity =
        Number(vehicle.capacity_kg);

      if (
        Number.isFinite(existingCapacity) &&
        existingCapacity < capacity
      ) {
        if (message) {
          message.textContent =
            `Vehicle ${vehicleNumber} already exists with ${existingCapacity} kg capacity.`;
        }

        if (button) {
          button.disabled = false;
          button.textContent = "Register & Become Available";
        }

        return;
      }
    }

    const result = await api(
      "/api/v1/drivers/create",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          phone: phone || null,
          license_number: licenseNumber || null,
          vehicle_id: vehicle.id
        })
      }
    );

    const driver =
      result?.driver || result;

    if (!driver?.id) {
      throw new Error(
        "Driver registration succeeded but no driver ID was returned."
      );
    }

    localStorage.setItem(
      "DAL_DRIVER_ID",
      driver.id
    );

    const url =
      new URL(window.location.href);

    url.searchParams.set(
      "driver_id",
      driver.id
    );

    if (message) {
      message.textContent =
        "Registration successful. Loading your driver portal...";
    }

    window.location.href =
      url.toString();
  } catch (error) {
    console.error(
      "Driver registration failed:",
      error
    );

    if (message) {
      message.textContent =
        error.message ||
        "Registration failed. Please try again.";
    }

    if (button) {
      button.disabled = false;
      button.textContent =
        "Register & Become Available";
    }
  }
}

/* =========================================================
DRIVER SELECTION BUTTON
========================================================= */

function updateDriverSelectionButton() {
  const select =
    $("driverSelect");

  const button =
    $("continueDriverButton");

  if (!select || !button) {
    return;
  }

  button.disabled =
    !select.value;
}

/* =========================================================
HANDLE DRIVER SELECTION
========================================================= */

function handleDriverSelection() {
  const select =
    $("driverSelect");

  if (!select?.value) {
    alert(
      "Please select a driver."
    );

    return;
  }

  const selectedDriver =
    state.drivers.find(
      driver =>
        String(driver.id) ===
        String(select.value)
    );

  if (!selectedDriver) {
    alert(
      "Selected driver could not be found."
    );

    return;
  }

  localStorage.setItem(
    "DAL_DRIVER_ID",
    selectedDriver.id
  );

  const url =
    new URL(
      window.location.href
    );

  url.searchParams.set(
    "driver_id",
    selectedDriver.id
  );

  window.location.href =
    url.toString();
}

/* =========================================================
DRIVER VEHICLE
========================================================= */

function findDriverVehicle(
  driver,
  vehicles
) {
  if (!driver) {
    return null;
  }

  const vehicleId =
    driver.vehicle_id;

  if (!vehicleId) {
    return null;
  }

  return (
    vehicles.find(
      vehicle =>
        String(vehicle.id) ===
        String(vehicleId)
    ) ||
    null
  );
}

/* =========================================================
COLLECTION NORMALIZATION
========================================================= */

function normalizeCollection(response) {
  if (Array.isArray(response)) {
    return response;
  }

  if (!response) {
    return [];
  }

  if (Array.isArray(response.items)) {
    return response.items;
  }

  if (Array.isArray(response.data)) {
    return response.data;
  }

  if (Array.isArray(response.results)) {
    return response.results;
  }

  return [];
}

/* =========================================================
FIND ASSIGNED SHIPMENT
========================================================= */

function findAssignedShipment(
  shipments,
  vehicle
) {
  if (!vehicle) {
    return null;
  }

  const vehicleId =
    String(vehicle.id);

  const assigned =
    shipments.filter(
      shipment => {
        const assignedVehicle =
          shipment.vehicle_id ||
          shipment.assigned_vehicle_id ||
          shipment.vehicle?.id;

        return (
          assignedVehicle &&
          String(assignedVehicle) ===
          vehicleId &&
          !isCompletedShipment(
            shipment
          )
        );
      }
    );

  return (
    assigned.find(
      shipment =>
        String(
          shipment.status
        ).toLowerCase() ===
        "in_transit"
    ) ||

    assigned.find(
      shipment =>
        String(
          shipment.status
        ).toLowerCase() ===
        "assigned"
    ) ||

    assigned.find(
      shipment =>
        String(
          shipment.status
        ).toLowerCase() ===
        "pending"
    ) ||

    assigned[0] ||

    null
  );
}

/* =========================================================
STATUS HELPERS
========================================================= */

function isActiveVehicle(vehicle) {
  const status =
    String(
      vehicle.status || ""
    ).toLowerCase();

  return (
    status === "available" ||
    status === "assigned" ||
    status === "in_transit" ||
    status === "active"
  );
}

function isCompletedShipment(shipment) {
  const status =
    String(
      shipment.status || ""
    ).toLowerCase();

  return (
    status === "delivered" ||
    status === "cancelled" ||
    status === "completed"
  );
}

/* =========================================================
MISSION SUMMARY HELPERS
========================================================= */

function getVehicleCapacityKg(vehicle = state.vehicle) {
  if (!vehicle) return null;

  const value =
    vehicle.max_weight_kg ??
    vehicle.max_capacity_kg ??
    vehicle.capacity_kg ??
    vehicle.max_kg ??
    vehicle.load_capacity_kg;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getShipmentWeightKg(shipment = state.shipment) {
  if (!shipment) return null;

  const value =
    shipment.weight_kg ??
    shipment.weight ??
    shipment.load_kg;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getShipmentPriority(shipment = state.shipment) {
  if (!shipment) return "Normal";

  return (
    shipment.priority_level ||
    shipment.priority ||
    shipment.urgency_level ||
    "Normal"
  );
}

function renderMissionSummary() {
  const driverName =
    state.driver?.name || "--";

  const vehicleNumber =
    state.vehicle?.vehicle_number ||
    state.vehicle?.number ||
    state.vehicle?.name ||
    state.vehicle?.id ||
    "--";

  const capacity =
    getVehicleCapacityKg();

  const weight =
    getShipmentWeightKg();

  const priority =
    getShipmentPriority();

  setText("missionDriverName", driverName);
  setText("missionVehicleNumber", vehicleNumber);
  setText(
    "missionVehicleCapacity",
    capacity !== null ? `${number(capacity)} kg` : "--"
  );
  setText(
    "missionShipmentWeight",
    weight !== null ? `${number(weight)} kg` : "--"
  );
  setText("missionPriority", priority);

  const status =
    state.shipment?.status ||
    (state.navigationStarted ? "In Transit" : "Ready");

  setText("missionStatus", formatStatus(status));

  const statusElement = $("missionStatus");
  if (statusElement) {
    statusElement.classList.remove(
      "critical",
      "high",
      "normal",
      "warning"
    );

    const normalized = String(status).toLowerCase();
    if (normalized.includes("delivered") || normalized.includes("completed")) {
      statusElement.classList.add("normal");
    } else if (normalized.includes("transit")) {
      statusElement.classList.add("high");
    } else if (normalized.includes("waiting") || normalized.includes("assigned")) {
      statusElement.classList.add("warning");
    }
  }
}

function validateMissionCapacity() {
  const capacity = getVehicleCapacityKg();
  const weight = getShipmentWeightKg();

  if (capacity === null || weight === null) {
    return true;
  }

  if (weight > capacity) {
    showAlert(
      "Vehicle Capacity Exceeded",
      `Shipment weight is ${number(weight)} kg, but ${number(capacity)} kg is the maximum vehicle capacity.`
    );
    return false;
  }

  return true;
}

/* =========================================================
RENDER DRIVER
========================================================= */

function renderDriver() {
  if (!state.driver) {
    return;
  }

  setText(
    "driverName",
    state.driver.name
  );

  setText(
    "vehicleDriver",
    state.driver.name
  );

  const avatar =
    $("driverAvatar");

  if (avatar) {
    const initials =
      String(
        state.driver.name ||
        "DR"
      )
        .trim()
        .split(/\s+/)
        .map(
          part =>
            part.charAt(0)
        )
        .join("")
        .slice(0, 2)
        .toUpperCase();

    avatar.textContent =
      initials || "DR";
  }

  renderMissionSummary();
}

/* =========================================================
RENDER VEHICLE
========================================================= */

function renderVehicle() {
  if (!state.vehicle) {
    return;
  }

  setText(
    "vehicleNumber",
    state.vehicle.vehicle_number ||
    state.vehicle.number ||
    state.vehicle.name ||
    state.vehicle.id
  );

  setText(
    "vehicleStatus",
    formatStatus(
      state.vehicle.status
    )
  );

  const maxKg =
    state.vehicle.max_weight_kg ??
    state.vehicle.max_capacity_kg ??
    state.vehicle.capacity_kg ??
    state.vehicle.max_kg ??
    state.vehicle.load_capacity_kg;

  setText(
    "vehicleCapacity",
    maxKg !== null &&
    maxKg !== undefined &&
    maxKg !== ""
      ? `${number(maxKg)} kg`
      : "--"
  );

  setText(
    "vehicleMaxKg",
    maxKg !== null &&
    maxKg !== undefined &&
    maxKg !== ""
      ? `${number(maxKg)} kg`
      : "--"
  );

  const vehicleStatus =
    $("vehicleStatus")
      ?.parentElement;

  if (vehicleStatus) {
    vehicleStatus.classList.toggle(
      "connected",
      isActiveVehicle(
        state.vehicle
      )
    );
  }

  renderMissionSummary();
}

/* =========================================================
RENDER SHIPMENT
========================================================= */

function renderShipment() {
  const shipment =
    state.shipment;

  if (!shipment) {
    return;
  }

  setText(
    "shipmentId",
    shipment.id
  );

  setText(
    "priorityBadge",
    shipment.priority_level ||
    shipment.priority ||
    shipment.urgency_level ||
    "Normal"
  );

  const priority =
    String(
      shipment.priority_level ||
      shipment.priority ||
      shipment.urgency_level ||
      "normal"
    ).toLowerCase();

  const badge =
    $("priorityBadge");

  if (badge) {
    badge.className =
      "priority-badge";

    if (
      priority.includes("critical")
    ) {
      badge.classList.add(
        "critical"
      );
    } else if (
      priority.includes("high")
    ) {
      badge.classList.add(
        "high"
      );
    } else {
      badge.classList.add(
        "normal"
      );
    }
  }

  setText(
    "shipmentCategory",
    shipment.category
  );

  setText(
    "shipmentWeight",
    shipment.weight_kg !== undefined
      ? `${shipment.weight_kg} kg`
      : "--"
  );

  setText(
    "shipmentStatus",
    formatStatus(
      shipment.status
    )
  );

  const originName =
    shipment.origin_name ||
    shipment.origin ||
    shipment.from_name ||
    shipment.from;

  const destinationName =
    shipment.destination_name ||
    shipment.destination ||
    shipment.to_name ||
    shipment.to;

  if (originName) {
    setText(
      "originName",
      originName
    );
  } else if (
    validCoordinate(
      shipment.origin_lat,
      shipment.origin_lon
    )
  ) {
    setText(
      "originName",
      coordinateLabel(
        shipment.origin_lat,
        shipment.origin_lon
      )
    );
  }

  if (destinationName) {
    setText(
      "destinationName",
      destinationName
    );
  } else if (
    validCoordinate(
      shipment.destination_lat,
      shipment.destination_lon
    )
  ) {
    setText(
      "destinationName",
      coordinateLabel(
        shipment.destination_lat,
        shipment.destination_lon
      )
    );
  }

  renderMissionSummary();
}

/* =========================================================
NO VEHICLE
========================================================= */

function renderNoVehicle() {
  hide(
    "startNavigationButton"
  );

  hide(
    "stopNavigationButton"
  );

  hide(
    "deliverButton"
  );

  setText(
    "vehicleNumber",
    "No Vehicle"
  );

  renderMissionSummary();

  setText(
    "vehicleStatus",
    "Not Linked"
  );

  setText(
    "vehicleCapacity",
    "--"
  );

  setText(
    "vehicleMaxKg",
    "--"
  );

  setText(
    "shipmentId",
    "No Vehicle"
  );

  setText(
    "shipmentStatus",
    "Waiting"
  );

  renderMissionSummary();

  const routeList =
    $("routeList");

  if (routeList) {
    routeList.innerHTML = `
      <div class="loading-state">
          <span>
              No vehicle is linked to
              ${escapeHtml(
                state.driver?.name ||
                "this driver"
              )}.
          </span>
      </div>
    `;
  }
}

/* =========================================================
MAP MARKERS
========================================================= */

function renderShipmentMarkers() {
  if (!state.map ||
  !state.shipment) {
    return;
  }

  removeMarker(
    "originMarker"
  );

  removeMarker(
    "destinationMarker"
  );

  const shipment =
    state.shipment;

  if (
    validCoordinate(
      shipment.origin_lat,
      shipment.origin_lon
    )
  ) {
    state.originMarker =
      L.marker(
        [
          shipment.origin_lat,
          shipment.origin_lon
        ],
        {
          icon:
            createLocationIcon(
              "A"
            )
        }
      )
      .addTo(state.map)
      .bindPopup(
        `<strong>Pickup</strong><br>` +
        `${escapeHtml(
          shipment.origin_name ||
          shipment.origin ||
          coordinateLabel(
            shipment.origin_lat,
            shipment.origin_lon
          )
        )}`
      );
  }

  if (
    validCoordinate(
      shipment.destination_lat,
      shipment.destination_lon
    )
  ) {
    state.destinationMarker =
      L.marker(
        [
          shipment.destination_lat,
          shipment.destination_lon
        ],
        {
          icon:
            createLocationIcon(
              "B"
            )
        }
      )
      .addTo(state.map)
      .bindPopup(
        `<strong>Destination</strong><br>` +
        `${escapeHtml(
          shipment.destination_name ||
          shipment.destination ||
          coordinateLabel(
            shipment.destination_lat,
            shipment.destination_lon
          )
        )}`
      );
  }
}

function createLocationIcon(letter) {
  return L.divIcon({
    className:
      "dal-location-marker",

    html:
      `<div style="
        width:30px;
        height:30px;
        border-radius:9px;
        display:flex;
        align-items:center;
        justify-content:center;
        background:#0d1422;
        color:white;
        border:2px solid #3b82f6;
        box-shadow:0 5px 15px rgba(0,0,0,.35);
        font-size:10px;
        font-weight:800;
      ">${letter}</div>`,

    iconSize: [30, 30],

    iconAnchor: [15, 15]
  });
}

function removeMarker(
  property
) {
  if (
    state[property] &&
    state.map
  ) {
    state.map.removeLayer(
      state[property]
    );

    state[property] = null;
  }
}

/* =========================================================
VEHICLE MARKER
========================================================= */

function updateVehicleMarker(
  latitude,
  longitude
) {
  if (
    !state.map ||
    !validCoordinate(
      latitude,
      longitude
    )
  ) {
    return;
  }

  const position =
    [
      Number(latitude),
      Number(longitude)
    ];

  if (!state.vehicleMarker) {
    state.vehicleMarker =
      L.marker(
        position,
        {
          icon:
            createVehicleIcon()
        }
      )
      .addTo(state.map)
      .bindPopup(
        vehiclePopup()
      );
  } else {
    state.vehicleMarker
      .setLatLng(position);
  }

  if (
    state.navigationStarted &&
    state.followingVehicle
  ) {
    state.map.panTo(
      position,
      {
        animate: true,
        duration: 0.6
      }
    );
  }
}

function createVehicleIcon() {
  return L.divIcon({
    className:
      "dal-vehicle-marker",

    html: `
      <div class="vehicle-marker-wrapper">
          <div class="vehicle-pulse"></div>

          <div class="vehicle-marker">
              🚚
          </div>
      </div>
    `,

    iconSize: [42, 42],

    iconAnchor: [21, 21]
  });
}

function vehiclePopup() {
  const vehicle =
    state.vehicle;

  if (!vehicle) {
    return "DAL Vehicle";
  }

  return `
    <strong>
        ${escapeHtml(
          vehicle.vehicle_number ||
          vehicle.id
        )}
    </strong>
    <br>
    <span>
        ${escapeHtml(
          state.driver?.name ||
          "DAL Driver"
        )}
    </span>
    <br>
    <span>
        Live vehicle position
    </span>
  `;
}

/* =========================================================
INTELLIGENCE
========================================================= */

async function refreshIntelligence() {
  if (!state.shipment) {
    return;
  }

  try {
    const intelligence =
      await getShipmentIntelligence();

    state.lastIntelligence =
      intelligence;

    processIntelligence(
      intelligence
    );

    setConnection(
      "connected",
      "Live Intelligence"
    );

    setText(
      "lastUpdated",
      `Updated ${new Date()
        .toLocaleTimeString()}`
    );
  } catch (error) {
    console.error(
      "Intelligence error:",
      error
    );

    setConnection(
      "error",
      "Intelligence Offline"
    );
  }
}

/* =========================================================
INTELLIGENCE ENDPOINTS
========================================================= */

async function getShipmentIntelligence() {
  const shipmentId =
    encodeURIComponent(
      state.shipment.id
    );

  try {
    return await api(
      `/api/v1/shipments/${shipmentId}/intelligence`
    );
  } catch (primaryError) {
    console.warn(
      "Primary intelligence endpoint unavailable.",
      primaryError.message
    );
  }

  return await api(
    `/api/v1/routes/optimize?shipment_id=${shipmentId}`
  );
}

/* =========================================================
PROCESS INTELLIGENCE
========================================================= */

function processIntelligence(
  intelligence
) {
  if (!intelligence) {
    return;
  }

  updateRoutes(
    extractRoutes(
      intelligence
    )
  );

  updateRisk(
    intelligence
  );

  updateJourneyStats(
    intelligence
  );

  updateAlerts(
    intelligence
  );

  updateNavigationInstruction(
    intelligence
  );

  const vehiclePosition =
    extractVehiclePosition(
      intelligence
    );

  if (vehiclePosition) {
    updateVehicleMarker(
      vehiclePosition.lat,
      vehiclePosition.lon
    );
  }

  if (
    state.navigationStarted &&
    state.selectedRoute
  ) {
    checkForReroute(
      intelligence
    );
  }
}

/* =========================================================
EXTRACT ROUTES
========================================================= */

function extractRoutes(
  intelligence
) {
  const candidates = [
    intelligence.routes,
    intelligence.route_options,
    intelligence.alternatives,
    intelligence.traffic_routes,
    intelligence.routeAlternatives
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate) &&
      candidate.length > 0) {
      return candidate;
    }
  }

  if (
    intelligence.route &&
    typeof intelligence.route ===
    "object"
  ) {
    return [
      intelligence.route
    ];
  }

  return [];
}

/* =========================================================
ROUTE NORMALIZATION
========================================================= */

function normalizeRoute(
  route,
  index
) {
  const risk =
    normalizeRisk(
      route.risk ??
      route.risk_percent ??
      route.risk_score ??
      route.route_risk ??
      route.disruption_risk
    );

  const riskLevel =
    normalizeRiskLevel(
      route.risk_level ||
      route.condition ||
      route.status ||
      risk
    );

  const distance =
    number(
      route.distance_km ??
      route.distance ??
      route.distanceKm
    );

  const duration =
    number(
      route.duration_minutes ??
      route.estimated_time_minutes ??
      route.duration ??
      route.eta_minutes ??
      route.durationMin
    );

  const traffic =
    number(
      route.traffic_score ??
      route.traffic ??
      route.congestion_score
    );

  const accessibility =
    normalizeAccessibility(
      route.accessibility_percent ??
      route.road_accessibility_percent ??
      route.accessibility_score ??
      route.accessibility ??
      0
    );

  const geometry =
    extractGeometry(
      route
    );

  return {
    ...route,

    index,

    id:
      route.id ||
      route.route_id ||
      `route-${index + 1}`,

    name:
      route.name ||
      route.route_name ||
      `Route ${index + 1}`,

    distance,

    duration,

    risk,

    riskLevel,

    traffic,

    accessibility,

    geometry
  };
}

function normalizeAccessibility(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  let accessibility = Number(value);

  if (!Number.isFinite(accessibility)) {
    return 0;
  }

  if (accessibility > 1) {
    accessibility /= 100;
  }

  return clamp(accessibility, 0, 1);
}

/* =========================================================
RISK NORMALIZATION
========================================================= */

function normalizeRisk(
  value
) {
  if (
    value === null ||
    value === undefined
  ) {
    return 0;
  }

  let risk =
    number(value);

  if (risk > 1) {
    risk /= 100;
  }

  return clamp(
    risk,
    0,
    1
  );
}

function normalizeRiskLevel(
  value
) {
  if (
    typeof value === "number"
  ) {
    const risk =
      normalizeRisk(
        value
      );

    if (risk >= 0.60) {
      return "dangerous";
    }

    if (risk >= 0.40) {
      return "moderate";
    }

    return "safe";
  }

  const text =
    String(
      value || ""
    ).toLowerCase();

  if (
    text.includes("critical") ||
    text.includes("danger") ||
    text.includes("high")
  ) {
    return "dangerous";
  }

  if (
    text.includes("moderate") ||
    text.includes("medium")
  ) {
    return "moderate";
  }

  return "safe";
}

/* =========================================================
ROUTE GEOMETRY
========================================================= */

function extractGeometry(
  route
) {
  if (
    route.geometry &&
    Array.isArray(
      route.geometry.coordinates
    )
  ) {
    return route.geometry;
  }

  if (
    Array.isArray(
      route.geometry
    )
  ) {
    return {
      type: "LineString",
      coordinates:
        route.geometry
    };
  }

  if (
    Array.isArray(
      route.coordinates
    )
  ) {
    return {
      type: "LineString",
      coordinates:
        route.coordinates
    };
  }

  if (
    route.geojson &&
    route.geojson.geometry
  ) {
    return route.geojson.geometry;
  }

  return null;
}

/* =========================================================
DRAW ROUTES
========================================================= */

function updateRoutes(
  rawRoutes
) {
  const routes =
    rawRoutes.map(
      normalizeRoute
    );

  state.routes =
    routes;

  drawRoutes(
    routes
  );

  renderRouteCards(
    routes
  );

  if (
    routes.length > 0 &&
    !state.selectedRoute
  ) {
    const safest =
      chooseSafestRoute(
        routes
      );

    selectRoute(
      safest,
      false
    );
  }
}

/* =========================================================
ROUTE DRAWING
========================================================= */

function drawRoutes(
  routes
) {
  clearRouteLayers();

  routes.forEach(
    (route, index) => {
      const latLngs =
        geometryToLatLngs(
          route.geometry
        );

      if (
        !latLngs ||
        latLngs.length < 2
      ) {
        return;
      }

      const layer =
        L.polyline(
          latLngs,
          {
            color:
              routeColor(
                route.riskLevel
              ),

            weight:
              route ===
              state.selectedRoute
                ? 7
                : 4,

            opacity:
              route ===
              state.selectedRoute
                ? 0.95
                : 0.55,

            lineCap: "round",

            lineJoin: "round"
          }
        )
        .addTo(state.map);

      layer.on(
        "click",
        () => {
          selectRoute(
            route,
            true
          );
        }
      );

      layer.bindTooltip(
        route.name,
        {
          sticky: true,

          className:
            "route-label"
        }
      );

      state.routeLayers.push(
        {
          route,
          layer
        }
      );
    }
  );

  refreshSelectedRouteLayer();
}

function geometryToLatLngs(
  geometry
) {
  if (
    !geometry ||
    !Array.isArray(
      geometry.coordinates
    )
  ) {
    return null;
  }

  return geometry.coordinates
    .filter(
      coordinate =>
        Array.isArray(
          coordinate
        ) &&
        coordinate.length >= 2
    )
    .map(
      coordinate =>
        [
          Number(
            coordinate[1]
          ),
          Number(
            coordinate[0]
          )
        ]
    )
    .filter(
      coordinate =>
        validCoordinate(
          coordinate[0],
          coordinate[1]
        )
    );
}

/* =========================================================
CLEAR ROUTES
========================================================= */

function clearRouteLayers() {
  if (!state.map) {
    return;
  }

  state.routeLayers.forEach(
    item => {
      state.map.removeLayer(
        item.layer
      );
    }
  );

  state.routeLayers = [];
  state.selectedRouteLayer = null;
}

/* =========================================================
ROUTE COLORS
========================================================= */

function routeColor(
  level
) {
  if (level === "dangerous") {
    return "#ef4444";
  }

  if (level === "moderate") {
    return "#f59e0b";
  }

  return "#22c55e";
}

/* =========================================================
ROUTE CARDS
========================================================= */

function renderRouteCards(
  routes
) {
  const container =
    $("routeList");

  if (!container) {
    return;
  }

  if (!routes.length) {
    container.innerHTML = `
      <div class="loading-state">
          <span>
              No route alternatives returned
              by the routing engine.
          </span>
      </div>
    `;

    disableNavigation();

    return;
  }

  container.innerHTML =
    routes
      .slice(0, 3)
      .map(
        route =>
          routeCardHtml(
            route
          )
      )
      .join("");

  routes
    .slice(0, 3)
    .forEach(
      route => {
        const card =
          document.querySelector(
            `[data-route-id="${cssEscape(
              String(route.id)
            )}"]`
          );

        card?.addEventListener(
          "click",
          () => {
            selectRoute(
              route,
              true
            );
          }
        );
      }
    );

  refreshSelectedRouteLayer();

  if (state.selectedRoute) {
    enableNavigation();
  }
}

function routeCardHtml(
  route
) {
  const selected =
    state.selectedRoute &&
    String(
      state.selectedRoute.id
    ) ===
    String(route.id);

  const selectedClass =
    selected
      ? "selected"
      : "";

  const distance =
    route.distance > 0
      ? `${route.distance.toFixed(1)} km`
      : "Distance unavailable";

  const duration =
    route.duration > 0
      ? formatMinutes(
          route.duration
        )
      : "ETA unavailable";

  const riskPercent =
    Math.round(
      route.risk * 100
    );

  const riskLabel =
    route.riskLevel === "dangerous"
      ? "Dangerous"
      : route.riskLevel === "moderate"
          ? "Moderate"
          : "Safe";

  const recommended =
    isRecommendedRoute(
      route
    );

  return `
<button
    class="route-card ${route.riskLevel} ${selectedClass}"
    data-route-id="${escapeHtml(
      String(route.id)
    )}"
    type="button"
>

    <div class="route-number">
        ${route.index + 1}
    </div>

    <div class="route-info">

        <div class="route-title">

            <strong>
                ${escapeHtml(
                  route.name
                )}
            </strong>

            ${
              recommended
                ? `
                    <span class="route-recommended">
                        Recommended
                    </span>
                  `
                : ""
            }

        </div>

        <div class="route-subtitle">

            ${escapeHtml(
              routeSummary(
                route
              )
            )}

        </div>

        <div class="route-metrics">

            <span>
                ↗ ${distance}
            </span>

            <span>
                ⏱ ${duration}
            </span>

        </div>

    </div>

    <div class="route-risk">

        <strong
            class="${riskTextClass(
              route.riskLevel
            )}"
        >
            ${riskPercent}%
        </strong>

        <span
            class="${riskTextClass(
              route.riskLevel
            )}"
        >
            ${riskLabel}
        </span>

    </div>

</button>
`;
}

/* =========================================================
ROUTE SUMMARY
========================================================= */

function routeSummary(
  route
) {
  const traffic =
    route.traffic;

  if (
    traffic > 0.75
  ) {
    return "Heavy traffic / disruption exposure";
  }

  if (
    traffic > 0.45
  ) {
    return "Moderate traffic conditions";
  }

  if (
    route.accessibility > 0 &&
    route.accessibility < 0.55
  ) {
    return "Reduced road accessibility";
  }

  if (
    route.riskLevel ===
    "dangerous"
  ) {
    return "High disruption risk ahead";
  }

  if (
    route.riskLevel ===
    "moderate"
  ) {
    return "Moderate disruption risk";
  }

  return "Low-risk accessible route";
}

/* =========================================================
RECOMMENDED ROUTE
========================================================= */

function isRecommendedRoute(
  route
) {
  if (!state.routes.length) {
    return false;
  }

  const safest =
    chooseSafestRoute(
      state.routes
    );

  return (
    safest &&
    String(safest.id) ===
    String(route.id)
  );
}

function chooseSafestRoute(
  routes
) {
  if (!routes.length) {
    return null;
  }

  return [...routes]
    .sort(
      (a, b) =>
        routeScore(a) -
        routeScore(b)
    )[0];
}

function routeScore(
  route
) {
  const risk =
    route.risk;

  const traffic =
    route.traffic;

  const accessibilityPenalty =
    route.accessibility > 0
      ? 1 -
        route.accessibility
      : 0.5;

  const durationPenalty =
    route.duration > 0
      ? Math.min(
          route.duration / 180,
          1
        )
      : 0.5;

  const distancePenalty =
    route.distance > 0
      ? Math.min(
          route.distance / 300,
          1
        )
      : 0.5;

  return (
    risk * 0.55 +
    traffic * 0.20 +
    accessibilityPenalty * 0.12 +
    durationPenalty * 0.08 +
    distancePenalty * 0.05
  );
}

/* =========================================================
SELECT ROUTE
========================================================= */

async function selectRoute(
  route,
  sendToBackend = true
) {
  if (!route) {
    return;
  }

  state.selectedRoute =
    route;

  renderRouteCards(
    state.routes
  );

  refreshSelectedRouteLayer();

  const latLngs =
    geometryToLatLngs(
      route.geometry
    );

  if (
    latLngs &&
    latLngs.length > 1
  ) {
    state.map.fitBounds(
      L.latLngBounds(
        latLngs
      ),
      {
        padding: [55, 55]
      }
    );
  }

  if (
    sendToBackend &&
    state.shipment
  ) {
    try {
      await persistRouteSelection(
        route
      );
    } catch (error) {
      console.warn(
        "Route selection endpoint unavailable:",
        error.message
      );
    }
  }

  enableNavigation();
}

/* =========================================================
PERSIST ROUTE SELECTION
========================================================= */

async function persistRouteSelection(
  route
) {
  const shipmentId =
    encodeURIComponent(
      state.shipment.id
    );

  return await api(
    `/api/v1/shipments/${shipmentId}/route/select`,
    {
      method: "POST",

      body: JSON.stringify({
        route_id:
          route.id,

        route_name:
          route.name
      })
    }
  );
}

/* =========================================================
SELECTED ROUTE LAYER
========================================================= */

function refreshSelectedRouteLayer() {
  state.routeLayers.forEach(
    item => {
      const selected =
        state.selectedRoute &&
        String(
          item.route.id
        ) ===
        String(
          state.selectedRoute.id
        );

      item.layer.setStyle({
        weight:
          selected
            ? 7
            : 4,

        opacity:
          selected
            ? 0.95
            : 0.5,

        color:
          routeColor(
            item.route.riskLevel
          )
      });

      if (selected) {
        item.layer.bringToFront();

        state.selectedRouteLayer =
          item.layer;
      }
    }
  );
}

/* =========================================================
NAVIGATION
========================================================= */

function enableNavigation() {
  const button =
    $("startNavigationButton");

  if (button) {
    button.disabled =
      !state.selectedRoute;
  }
}

function disableNavigation() {
  const button =
    $("startNavigationButton");

  if (button) {
    button.disabled = true;
  }
}

/* =========================================================
START NAVIGATION
========================================================= */

function startNavigation() {
  if (
    !state.driver ||
    !state.vehicle ||
    !state.shipment ||
    !state.selectedRoute
  ) {
    alert(
      "Driver, vehicle, shipment and route are required."
    );

    return;
  }

  if (!validateMissionCapacity()) {
    return;
  }

  state.navigationStarted =
    true;

  show(
    "navigationBanner"
  );

  hide(
    "startNavigationButton"
  );

  show(
    "stopNavigationButton"
  );

  show(
    "deliverButton"
  );

  setText(
    "shipmentStatus",
    "In Transit"
  );

  renderMissionSummary();

  startGpsTracking();

  centerOnVehicle();

  setConnection(
    "connected",
    "Navigation Live"
  );
}

/* =========================================================
STOP NAVIGATION
========================================================= */

function stopNavigation() {
  state.navigationStarted =
    false;

  stopGpsTracking();

  hide(
    "navigationBanner"
  );

  hide(
    "stopNavigationButton"
  );

  show(
    "startNavigationButton"
  );

  hide(
    "deliverButton"
  );

  enableNavigation();

  renderMissionSummary();

  setConnection(
    "connected",
    "Navigation Paused"
  );
}

/* =========================================================
GPS TRACKING
========================================================= */

function startGpsTracking() {
  if (
    !navigator.geolocation
  ) {
    setGpsStatus(
      "GPS unavailable",
      "Browser does not support geolocation"
    );

    return;
  }

  if (
    state.gpsWatchId !== null
  ) {
    return;
  }

  setGpsStatus(
    "Requesting GPS",
    "Waiting for high accuracy location..."
  );

  state.gpsWatchId =
    navigator.geolocation.watchPosition(
      handleGpsPosition,
      handleGpsError,
      CONFIG.GPS_OPTIONS
    );
}

/* =========================================================
STOP GPS
========================================================= */

function stopGpsTracking() {
  if (
    state.gpsWatchId !== null
  ) {
    navigator.geolocation.clearWatch(
      state.gpsWatchId
    );

    state.gpsWatchId = null;
  }
}

/* =========================================================
GPS SUCCESS
========================================================= */

async function handleGpsPosition(
  position
) {
  const {
    latitude,
    longitude,
    accuracy,
    speed
  } = position.coords;

  const now =
    Date.now();

  state.previousPosition =
    state.currentPosition;

  state.currentPosition = {
    lat: latitude,
    lon: longitude,

    accuracy,

    speed:
      Number.isFinite(speed)
        ? speed * 3.6
        : estimateSpeed(),

    timestamp:
      position.timestamp
  };

  updateVehicleMarker(
    latitude,
    longitude
  );

  setGpsStatus(
    "GPS Active",
    `Accuracy ±${Math.round(
      accuracy
    )} m`
  );

  setText(
    "speedValue",
    Number.isFinite(
      state.currentPosition.speed
    )
      ? `${Math.round(
          state.currentPosition.speed
        )} km/h`
      : "--"
  );

  if (
    now -
    state.lastGpsSentAt >=
    CONFIG.GPS_SEND_INTERVAL
  ) {
    state.lastGpsSentAt =
      now;

    await sendGpsToBackend();
  }

  updateProgressFromGps();
}

/* =========================================================
ESTIMATE SPEED
========================================================= */

function estimateSpeed() {
  if (
    !state.previousPosition ||
    !state.currentPosition
  ) {
    return null;
  }

  const previous =
    state.previousPosition;

  const current =
    state.currentPosition;

  const distance =
    haversineKm(
      previous.lat,
      previous.lon,
      current.lat,
      current.lon
    );

  const timeHours =
    (
      current.timestamp -
      previous.timestamp
    ) /
    3600000;

  if (
    timeHours <= 0
  ) {
    return null;
  }

  return (
    distance /
    timeHours
  );
}

/* =========================================================
SEND GPS
========================================================= */

async function sendGpsToBackend() {
  if (
    !state.vehicle ||
    !state.currentPosition
  ) {
    return;
  }

  const vehicleId =
    encodeURIComponent(
      state.vehicle.id
    );

  try {
    await api(
      `/api/v1/vehicles/${vehicleId}/update-location`,
      {
        method: "POST",

        body: JSON.stringify({
          latitude:
            state.currentPosition.lat,

          longitude:
            state.currentPosition.lon,

          speed_kmh:
            state.currentPosition.speed,

          status:
            "in_transit"
        })
      }
    );

    state.vehicle.current_lat =
      state.currentPosition.lat;

    state.vehicle.current_lon =
      state.currentPosition.lon;

    setConnection(
      "connected",
      "GPS Synced"
    );
  } catch (error) {
    console.error(
      "GPS update failed:",
      error
    );

    setConnection(
      "error",
      "GPS Sync Failed"
    );
  }
}

/* =========================================================
GPS ERROR
========================================================= */

function handleGpsError(
  error
) {
  console.warn(
    "GPS error:",
    error
  );

  let message =
    "Unable to obtain location";

  if (
    error.code ===
    error.PERMISSION_DENIED
  ) {
    message =
      "Location permission denied";
  } else if (
    error.code ===
    error.POSITION_UNAVAILABLE
  ) {
    message =
      "Location unavailable";
  } else if (
    error.code ===
    error.TIMEOUT
  ) {
    message =
      "GPS request timed out";
  }

  setGpsStatus(
    "GPS Error",
    message
  );
}

/* =========================================================
GPS UI
========================================================= */

function setGpsStatus(
  status,
  detail
) {
  setText(
    "gpsStatus",
    status
  );

  setText(
    "gpsAccuracy",
    detail
  );
}

/* =========================================================
VEHICLE CENTER
========================================================= */

function centerOnVehicle() {
  if (
    !state.map
  ) {
    return;
  }

  if (
    state.currentPosition
  ) {
    state.map.setView(
      [
        state.currentPosition.lat,
        state.currentPosition.lon
      ],
      16,
      {
        animate: true
      }
    );

    return;
  }

  if (
    state.vehicle &&
    validCoordinate(
      state.vehicle.current_lat,
      state.vehicle.current_lon
    )
  ) {
    state.map.setView(
      [
        state.vehicle.current_lat,
        state.vehicle.current_lon
      ],
      15,
      {
        animate: true
      }
    );

    return;
  }

  if (
    state.shipment &&
    validCoordinate(
      state.shipment.origin_lat,
      state.shipment.origin_lon
    )
  ) {
    state.map.setView(
      [
        state.shipment.origin_lat,
        state.shipment.origin_lon
      ],
      12,
      {
        animate: true
      }
    );
  }
}

/* =========================================================
FOLLOW VEHICLE
========================================================= */

function toggleFollow() {
  state.followingVehicle =
    !state.followingVehicle;

  const button =
    $("followButton");

  button?.classList.toggle(
    "active",
    state.followingVehicle
  );

  if (
    state.followingVehicle
  ) {
    centerOnVehicle();
  }
}

/* =========================================================
JOURNEY PROGRESS
========================================================= */

function updateProgressFromGps() {
  if (
    !state.currentPosition ||
    !state.selectedRoute
  ) {
    return;
  }

  const route =
    state.selectedRoute;

  const latLngs =
    geometryToLatLngs(
      route.geometry
    );

  if (
    !latLngs ||
    latLngs.length < 2
  ) {
    return;
  }

  const nearest =
    nearestPointOnRoute(
      state.currentPosition,
      latLngs
    );

  if (!nearest) {
    return;
  }

  const totalDistance =
    polylineDistance(
      latLngs
    );

  const remainingDistance =
    polylineDistance(
      latLngs.slice(
        nearest.index
      )
    );

  const progress =
    totalDistance > 0
      ? clamp(
          1 -
          remainingDistance /
          totalDistance,
          0,
          1
        )
      : 0;

  if (
    totalDistance > 0
  ) {
    setText(
      "distanceValue",
      `${remainingDistance.toFixed(
        1
      )} km`
    );
  }

  updateEta(
    remainingDistance
  );

  if (
    progress >= 0.98
  ) {
    setText(
      "nextInstruction",
      "You are near the destination"
    );

    setText(
      "nextDistance",
      "Final"
    );
  }
}

/* =========================================================
ETA
========================================================= */

function updateEta(
  remainingDistance
) {
  let speed =
    state.currentPosition?.speed;

  if (
    !speed ||
    speed < 5
  ) {
    speed =
      estimateRouteSpeed();
  }

  if (
    !speed ||
    speed <= 0
  ) {
    return;
  }

  const minutes =
    (
      remainingDistance /
      speed
    ) * 60;

  setText(
    "etaValue",
    formatMinutes(
      minutes
    )
  );
}

function estimateRouteSpeed() {
  if (
    state.selectedRoute &&
    state.selectedRoute.duration > 0 &&
    state.selectedRoute.distance > 0
  ) {
    return (
      state.selectedRoute.distance /
      (
        state.selectedRoute.duration /
        60
      )
    );
  }

  return 35;
}

/* =========================================================
NAVIGATION INSTRUCTION
========================================================= */

function updateNavigationInstruction(
  intelligence
) {
  const instructions =
    intelligence.instructions ||
    intelligence.steps ||
    intelligence.navigation_steps;

  if (
    !Array.isArray(
      instructions
    ) ||
    !instructions.length
  ) {
    return;
  }

  const first =
    instructions[0];

  if (
    typeof first === "string"
  ) {
    setText(
      "nextInstruction",
      first
    );

    return;
  }

  setText(
    "nextInstruction",
    first.instruction ||
    first.name ||
    first.maneuver ||
    "Continue on route"
  );

  if (
    first.distance
  ) {
    setText(
      "nextDistance",
      formatDistance(
        first.distance
      )
    );
  }
}

/* =========================================================
RISK
========================================================= */

function updateRisk(
  intelligence
) {
  if (!intelligence) {
    return;
  }

  const selected = state.selectedRoute;

  // Prefer the journey-level AI risk from the backend.
  // Fall back to the selected route only when journey risk is absent.
  const rawRisk =
    intelligence.risk_percent ??
    intelligence.risk_percentage ??
    intelligence.risk_score ??
    intelligence.disruption_risk ??
    intelligence.risk ??
    selected?.risk;

  const hasRisk =
    rawRisk !== null &&
    rawRisk !== undefined &&
    rawRisk !== "" &&
    Number.isFinite(Number(rawRisk));

  if (!hasRisk) {
    setText("riskLevel", "ANALYZING");
    setText("riskScore", "--");

    const progress = $("riskProgress");
    if (progress) {
      progress.style.width = "0%";
    }
  } else {
    const risk = normalizeRisk(rawRisk);
    const percent = Math.round(risk * 100);

    const backendLevel =
      intelligence.risk_level ??
      intelligence.riskLevel;

    const level =
      backendLevel
        ? normalizeRiskLevel(backendLevel)
        : risk >= 0.75
          ? "dangerous"
          : risk >= 0.40
            ? "moderate"
            : "safe";

    const levelText =
      level === "dangerous"
        ? "HIGH RISK"
        : level === "moderate"
          ? "MODERATE RISK"
          : "LOW RISK";

    setText("riskLevel", levelText);
    setText("riskScore", `${percent}%`);

    const progress = $("riskProgress");
    if (progress) {
      progress.style.width = `${percent}%`;
      progress.style.background =
        level === "dangerous"
          ? "#ef4444"
          : level === "moderate"
            ? "#f59e0b"
            : "#22c55e";
    }
  }

  // WEATHER
  const weather = intelligence.weather;
  const weatherRisk =
    intelligence.weather_risk ??
    intelligence.weather_risk_percent ??
    intelligence.weather_score ??
    (weather && typeof weather === "object"
      ? weather.risk_percent ?? weather.risk_score ?? weather.risk
      : null);

  setText(
    "weatherRisk",
    weatherRisk !== null && weatherRisk !== undefined
      ? formatRiskValue(weatherRisk)
      : weather && typeof weather === "object" && weather.condition
        ? String(weather.condition)
        : "Unavailable"
  );

  // TRAFFIC
  const trafficUnavailable =
    intelligence.traffic_available === false ||
    String(intelligence.traffic_level ?? "").toLowerCase() === "unknown";

  const trafficValue =
    intelligence.traffic_risk ??
    intelligence.traffic_risk_percent ??
    intelligence.traffic_score ??
    intelligence.traffic;

  setText(
    "trafficRisk",
    trafficUnavailable
      ? "Unavailable"
      : trafficValue !== null && trafficValue !== undefined
        ? formatRiskValue(trafficValue)
        : intelligence.traffic_level
          ? formatStatus(intelligence.traffic_level)
          : "Unavailable"
  );

  // ROAD: backend accessibility is a positive percentage, so display
  // accessibility rather than accidentally calling 92% accessibility 92% risk.
  const roadAccessibility =
    intelligence.road_accessibility_percent ??
    intelligence.accessibility_percent ??
    intelligence.road_accessibility ??
    intelligence.accessibility ??
    selected?.accessibility;

  if (roadAccessibility !== null && roadAccessibility !== undefined && roadAccessibility !== "") {
    const accessibility = normalizeAccessibility(roadAccessibility);
    setText("roadRisk", `${Math.round(accessibility * 100)}% accessible`);
  } else {
    const roadRisk =
      intelligence.road_risk ??
      intelligence.road_risk_percent ??
      intelligence.accessibility_risk;

    setText(
      "roadRisk",
      roadRisk !== null && roadRisk !== undefined
        ? formatRiskValue(roadRisk)
        : "Unavailable"
    );
  }
}


function formatRiskValue(
  value
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "--";
  }

  if (
    typeof value === "string"
  ) {
    return value;
  }

  const normalized =
    normalizeRisk(
      value
    );

  return `${Math.round(
    normalized * 100
  )}%`;
}

/* =========================================================
ALERTS
========================================================= */

function updateAlerts(
  intelligence
) {
  const alerts =
    intelligence.alerts ||
    intelligence.hazards ||
    intelligence.active_alerts;

  if (
    Array.isArray(alerts) &&
    alerts.length > 0
  ) {
    const alert =
      alerts[0];

    showAlert(
      alert.title ||
      alert.alert_type ||
      "Route Alert",

      alert.message ||
      alert.description ||
      "Hazard detected ahead."
    );

    return;
  }

  const risk =
    normalizeRisk(
      intelligence.risk_score ??
      intelligence.risk
    );

  if (
    risk >= 0.75
  ) {
    showAlert(
      "Critical Route Risk",
      "DAL has detected critical disruption risk on the current journey."
    );

    return;
  }

  hide(
    "alertCard"
  );
}

function showAlert(
  title,
  message
) {
  show(
    "alertCard"
  );

  setText(
    "alertTitle",
    title
  );

  setText(
    "alertMessage",
    message
  );
}

/* =========================================================
TRAFFIC-AHEAD / REROUTE
========================================================= */

function checkForReroute(
  intelligence
) {
  const selected =
    state.selectedRoute;

  if (!selected) {
    return;
  }

  const currentRisk =
    normalizeRisk(
      selected.risk
    );

  const safest =
    chooseSafestRoute(
      state.routes
    );

  if (
    !safest ||
    String(safest.id) ===
    String(selected.id)
  ) {
    return;
  }

  const saferBy =
    currentRisk -
    safest.risk;

  if (
    currentRisk >= 0.60 &&
    saferBy >= 0.15 &&
    !state.reroutePending
  ) {
    state.reroutePending =
      true;

    showRerouteModal(
      selected,
      safest
    );
  }
}

/* =========================================================
REROUTE MODAL
========================================================= */

function showRerouteModal(
  current,
  recommended
) {
  show(
    "rerouteModal"
  );

  setText(
    "rerouteMessage",
    `Current route risk is ${Math.round(
      current.risk * 100
    )}%. DAL found a safer alternative with ${Math.round(
      recommended.risk * 100
    )}% risk.`
  );

  setText(
    "currentRouteRisk",
    `${current.name} — ${Math.round(
      current.risk * 100
    )}%`
  );

  setText(
    "recommendedRouteRisk",
    `${recommended.name} — ${Math.round(
      recommended.risk * 100
    )}%`
  );
}

/* =========================================================
ACCEPT REROUTE
========================================================= */

async function acceptReroute() {
  const safest =
    chooseSafestRoute(
      state.routes
    );

  if (!safest) {
    return;
  }

  hide(
    "rerouteModal"
  );

  state.reroutePending =
    false;

  await selectRoute(
    safest,
    true
  );

  showAlert(
    "Route Updated",
    `${safest.name} selected as the safer route based on current conditions.`
  );
}

/* =========================================================
KEEP CURRENT ROUTE
========================================================= */

function keepCurrentRoute() {
  hide(
    "rerouteModal"
  );

  state.reroutePending =
    false;
}

/* =========================================================
DELIVERY
========================================================= */

async function markDelivered() {
  if (
    !state.shipment
  ) {
    return;
  }

  const confirmed =
    window.confirm(
      "Confirm that this shipment has been delivered?"
    );

  if (!confirmed) {
    return;
  }

  const shipmentId =
    encodeURIComponent(
      state.shipment.id
    );

  try {
    await api(
      `/api/v1/shipments/${shipmentId}/deliver`,
      {
        method: "POST"
      }
    );

    stopGpsTracking();

    state.navigationStarted =
      false;

    setText(
      "shipmentStatus",
      "Delivered"
    );

    renderMissionSummary();

    setText(
      "deliveredShipment",
      state.shipment.id
    );

    setText(
      "deliveredVehicle",
      state.vehicle.vehicle_number ||
      state.vehicle.id
    );

    hide(
      "stopNavigationButton"
    );

    hide(
      "deliverButton"
    );

    show(
      "deliveryModal"
    );

    setConnection(
      "connected",
      "Delivery Recorded"
    );
  } catch (error) {
    console.error(
      "Delivery failed:",
      error
    );

    alert(
      `Could not record delivery.\n\n${error.message}`
    );
  }
}

/* =========================================================
LOGOUT
========================================================= */

function logoutDriver() {
  const confirmed = window.confirm(
    "Logout from this driver portal?"
  );

  if (!confirmed) {
    return;
  }

  if (state.refreshTimer) {
    clearInterval(state.refreshTimer);
    state.refreshTimer = null;
  }

  stopGpsTracking();

  state.navigationStarted = false;
  state.reroutePending = false;
  state.driver = null;
  state.vehicle = null;
  state.shipment = null;
  state.routes = [];
  state.selectedRoute = null;
  state.lastIntelligence = null;
  state.currentPosition = null;
  state.previousPosition = null;
  state.lastGpsSentAt = 0;

  localStorage.removeItem("DAL_DRIVER_ID");

  const url = new URL(window.location.href);
  url.searchParams.delete("driver_id");

  // Reloading gives a clean application state without touching DAL_API_URL.
  window.location.replace(url.toString());
}

/* =========================================================
AUTO REFRESH
========================================================= */

function startAutoRefresh() {
  if (
    state.refreshTimer
  ) {
    clearInterval(
      state.refreshTimer
    );
  }

  state.refreshTimer =
    setInterval(
      async () => {
        try {
          await reloadLiveDriver();

          await refreshIntelligence();
        } catch (error) {
          console.error(
            "Live refresh failed:",
            error
          );
        }
      },
      CONFIG.REFRESH_INTERVAL
    );
}

/* =========================================================
LIVE DRIVER / VEHICLE REFRESH
========================================================= */

async function reloadLiveDriver() {
  if (
    !state.driver
  ) {
    return;
  }

  try {
    const [
      driversResponse,
      vehiclesResponse,
      shipmentsResponse
    ] = await Promise.all([
      api("/api/v1/drivers/"),
      api("/api/v1/vehicles"),
      api("/api/v1/shipments")
    ]);

    const drivers =
      normalizeCollection(
        driversResponse
      );

    const vehicles =
      normalizeCollection(
        vehiclesResponse
      );

    const shipments =
      normalizeCollection(
        shipmentsResponse
      );

    const updatedDriver =
      drivers.find(
        driver =>
          String(driver.id) ===
          String(state.driver.id)
      );

    if (updatedDriver) {
      state.driver =
        {
          ...state.driver,
          ...updatedDriver
        };
    }

    state.vehicle =
      findDriverVehicle(
        state.driver,
        vehicles
      );

    state.shipment =
      findAssignedShipment(
        shipments,
        state.vehicle
      );

    renderDriver();

    if (!state.vehicle) {
      renderNoVehicle();

      return;
    }

    renderVehicle();

    if (!state.shipment) {
      renderVehicleOnly();

      return;
    }

    renderShipment();

    renderShipmentMarkers();

    if (
      !state.currentPosition &&
      validCoordinate(
        state.vehicle.current_lat,
        state.vehicle.current_lon
      )
    ) {
      updateVehicleMarker(
        state.vehicle.current_lat,
        state.vehicle.current_lon
      );
    }
  } catch (error) {
    console.warn(
      "Driver refresh failed:",
      error.message
    );
  }
}

/* =========================================================
NO ASSIGNMENT UI
========================================================= */

function renderNoAssignment(
  message
) {
  hide(
    "startNavigationButton"
  );

  hide(
    "stopNavigationButton"
  );

  hide(
    "deliverButton"
  );

  const routeList =
    $("routeList");

  if (routeList) {
    routeList.innerHTML = `
      <div class="loading-state">
          <span>
              ${escapeHtml(
                message
              )}
          </span>
      </div>
    `;
  }

  setText(
    "shipmentId",
    "No Assignment"
  );

  setText(
    "shipmentStatus",
    "Waiting"
  );
}

function renderVehicleOnly() {
  setText(
    "shipmentId",
    "No Active Shipment"
  );

  setText(
    "shipmentStatus",
    "Waiting"
  );

  const routeList =
    $("routeList");

  if (routeList) {
    routeList.innerHTML = `
      <div class="loading-state">
          <span>
              No shipment is currently
              assigned to this vehicle.
          </span>
      </div>
    `;
  }

  disableNavigation();
}

/* =========================================================
INITIAL ERROR
========================================================= */

function showInitialError(
  message
) {
  show(
    "driverSelectionScreen"
  );

  const selectionMessage =
    $("driverSelectionMessage");

  if (selectionMessage) {
    selectionMessage.textContent =
      `Unable to connect to DAL backend: ${message}`;
  }

  const routeList =
    $("routeList");

  if (routeList) {
    routeList.innerHTML = `
      <div class="loading-state">
          <span>
              Unable to connect to DAL backend.
          </span>

          <small style="
              color:#657186;
              margin-top:5px;
              text-align:center;
              max-width:280px;
          ">
              ${escapeHtml(
                message
              )}
          </small>
      </div>
    `;
  }

  setText(
    "shipmentId",
    "Backend Offline"
  );

  setText(
    "shipmentStatus",
    "Connection Error"
  );
}

/* =========================================================
FORMATTING
========================================================= */

function formatStatus(
  status
) {
  if (!status) {
    return "--";
  }

  return String(status)
    .replace(/_/g, " ")
    .replace(
      /\b\w/g,
      char =>
        char.toUpperCase()
    );
}

function formatMinutes(
  minutes
) {
  const value =
    number(
      minutes,
      0
    );

  if (
    value < 1
  ) {
    return "<1 min";
  }

  const rounded =
    Math.round(
      value
    );

  if (
    rounded < 60
  ) {
    return `${rounded} min`;
  }

  const hours =
    Math.floor(
      rounded / 60
    );

  const remaining =
    rounded %
    60;

  if (
    remaining === 0
  ) {
    return `${hours} hr`;
  }

  return (
    `${hours} hr ${remaining} min`
  );
}

function formatDistance(
  value
) {
  const distance =
    number(
      value
    );

  if (
    distance <= 0
  ) {
    return "--";
  }

  if (
    distance < 1000
  ) {
    return `${Math.round(
      distance
    )} m`;
  }

  return `${(
    distance / 1000
  ).toFixed(1)} km`;
}

function riskTextClass(
  level
) {
  if (
    level === "dangerous"
  ) {
    return "dangerous-text";
  }

  if (
    level === "moderate"
  ) {
    return "moderate-text";
  }

  return "safe-text";
}

/* =========================================================
GEOGRAPHIC CALCULATIONS
========================================================= */

function haversineKm(
  lat1,
  lon1,
  lat2,
  lon2
) {
  const R =
    6371;

  const dLat =
    toRadians(
      lat2 - lat1
    );

  const dLon =
    toRadians(
      lon2 - lon1
    );

  const a =
    Math.sin(
      dLat / 2
    ) ** 2 +

    Math.cos(
      toRadians(lat1)
    ) *

    Math.cos(
      toRadians(lat2)
    ) *

    Math.sin(
      dLon / 2
    ) ** 2;

  const c =
    2 *
    Math.atan2(
      Math.sqrt(a),
      Math.sqrt(1 - a)
    );

  return R * c;
}

function toRadians(
  degrees
) {
  return (
    degrees *
    Math.PI /
    180
  );
}

function polylineDistance(
  points
) {
  if (
    !points ||
    points.length < 2
  ) {
    return 0;
  }

  let total = 0;

  for (
    let i = 1;
    i < points.length;
    i++
  ) {
    total +=
      haversineKm(
        points[i - 1][0],
        points[i - 1][1],
        points[i][0],
        points[i][1]
      );
  }

  return total;
}

/* =========================================================
NEAREST ROUTE POINT
========================================================= */

function nearestPointOnRoute(
  position,
  points
) {
  if (
    !position ||
    !points ||
    !points.length
  ) {
    return null;
  }

  let nearestIndex = 0;

  let smallestDistance =
    Infinity;

  points.forEach(
    (point, index) => {
      const distance =
        haversineKm(
          position.lat,
          position.lon,
          point[0],
          point[1]
        );

      if (
        distance <
        smallestDistance
      ) {
        smallestDistance =
          distance;

        nearestIndex =
          index;
      }
    }
  );

  return {
    index:
      nearestIndex,

    distance:
      smallestDistance
  };
}

/* =========================================================
VEHICLE POSITION EXTRACTION
========================================================= */

function extractVehiclePosition(
  intelligence
) {
  const candidates = [
    intelligence.vehicle_position,
    intelligence.vehicle_location,
    intelligence.current_position,
    intelligence.position
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const lat =
      candidate.lat ??
      candidate.latitude;

    const lon =
      candidate.lon ??
      candidate.lng ??
      candidate.longitude;

    if (
      validCoordinate(
        lat,
        lon
      )
    ) {
      return {
        lat: Number(lat),
        lon: Number(lon)
      };
    }
  }

  return null;
}

/* =========================================================
ESCAPING
========================================================= */

function escapeHtml(
  value
) {
  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );
}

function cssEscape(
  value
) {
  if (
    window.CSS &&
    typeof CSS.escape ===
    "function"
  ) {
    return CSS.escape(
      value
    );
  }

  return String(value)
    .replace(
      /[^a-zA-Z0-9_-]/g,
      "\\$&"
    );
}

/* =========================================================
COORDINATE HELPERS
========================================================= */

function validCoordinate(
  lat,
  lon
) {
  return (
    Number.isFinite(
      Number(lat)
    ) &&
    Number.isFinite(
      Number(lon)
    ) &&
    Number(lat) >= -90 &&
    Number(lat) <= 90 &&
    Number(lon) >= -180 &&
    Number(lon) <= 180
  );
}

function coordinateLabel(
  lat,
  lon
) {
  return (
    `${number(lat).toFixed(5)}, ` +
    `${number(lon).toFixed(5)}`
  );
}

/* =========================================================
DEBUG ACCESS
========================================================= */

window.DAL_DRIVER = {
  state,

  refresh:
    refreshIntelligence,

  center:
    centerOnVehicle,

  start:
    startNavigation,

  stop:
    stopNavigation,

  logout:
    logoutDriver
};