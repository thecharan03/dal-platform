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

  if (
    contentType.includes(
      "application/json"
    )
  ) {
    data =
      await response.json();
  } else {
    data =
      await response.text();
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
        .map(
          item =>
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
    element.classList.add(
      "connected"
    );
  }

  if (status === "error") {
    element.classList.add(
      "error"
    );
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
        "&copy; OpenStreetMap contributors"
    }
  ).addTo(state.map);

  state.map.on(
    "dragstart",
    () => {
      state.followingVehicle = false;

      $("followButton")
        ?.classList.remove(
          "active"
        );
    }
  );
}

/* =========================================================
BUTTON EVENTS
========================================================= */

function bindEvents() {
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
        hide(
          "deliveryModal"
        );
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
TOGGLE FOLLOW MODE
========================================================= */

function toggleFollow() {
  state.followingVehicle = !state.followingVehicle;

  const button = document.getElementById("followButton");

  if (button) {
    button.textContent = state.followingVehicle
      ? "Following Vehicle"
      : "Follow Vehicle";
  }

  if (state.followingVehicle) {
    centerOnVehicle();
  }
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
    params.get(
      "driver_id"
    );

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
  show(
    "driverSelectionScreen"
  );

  hide(
    "driverApplication"
  );

  const select =
    $("driverSelect");

  const button =
    $("continueDriverButton");

  const message =
    $("driverSelectionMessage");

  if (!drivers.length) {
    renderDriverRegistrationForm();

    return;
  }

  if (select) {
    select.disabled = false;

    select.innerHTML = `
      <option value="">
          Select driver...
      </option>

      ${drivers
        .map(
          driver => `
          <option value="${escapeHtml(
            String(driver.id)
          )}">
              ${escapeHtml(
                driver.name ||
                "Unnamed Driver"
              )}
          </option>
        `
        )
        .join("")}
    `;
  }

  if (button) {
    button.disabled = true;
  }

  if (message) {
    message.textContent =
      `${drivers.length} driver${drivers.length === 1 ? "" : "s"} available. Select your driver to continue.`;
  }
}

/* =========================================================
DRIVER SELF-REGISTRATION
========================================================= */

function renderDriverRegistrationForm() {
  const card =
    document.querySelector(
      ".driver-selection-card"
    );

  if (!card) {
    return;
  }

  card.innerHTML = `
    <div class="driver-selection-icon">🚚</div>

    <h2>Register Driver</h2>

    <p>
      Enter your driver and vehicle details
      to become available for assignments.
    </p>

    <div
      style="
        display:grid;
        gap:12px;
        text-align:left;
        margin-top:18px;
      "
    >
      <label>
        <span>Driver Name</span>

        <input
          id="registerDriverName"
          type="text"
          placeholder="Enter driver name"
          autocomplete="name"
        >
      </label>

      <label>
        <span>Phone Number</span>

        <input
          id="registerDriverPhone"
          type="tel"
          placeholder="Enter phone number"
          autocomplete="tel"
        >
      </label>

      <label>
        <span>License Number</span>

        <input
          id="registerDriverLicense"
          type="text"
          placeholder="Enter license number"
        >
      </label>

      <label>
        <span>Vehicle Number</span>

        <input
          id="registerVehicleNumber"
          type="text"
          placeholder="e.g. NEXORA-01"
        >
      </label>

      <label>
        <span>Vehicle Capacity (kg)</span>

        <input
          id="registerVehicleCapacity"
          type="number"
          min="1"
          step="1"
          placeholder="e.g. 5000"
        >
      </label>
    </div>

    <button
      id="registerDriverButton"
      type="button"
      style="
        width:100%;
        margin-top:18px;
      "
    >
      Register & Become Available
    </button>

    <div
      id="driverRegistrationMessage"
      style="
        margin-top:10px;
        text-align:center;
      "
    ></div>
  `;

  $("registerDriverButton")
    ?.addEventListener(
      "click",
      handleDriverRegistration
    );
}

/* =========================================================
DRIVER REGISTRATION
========================================================= */

async function handleDriverRegistration() {
  const button =
    $("registerDriverButton");

  const message =
    $("driverRegistrationMessage");

  const name =
    $("registerDriverName")
      ?.value
      .trim();

  const phone =
    $("registerDriverPhone")
      ?.value
      .trim();

  const licenseNumber =
    $("registerDriverLicense")
      ?.value
      .trim();

  const vehicleNumber =
    $("registerVehicleNumber")
      ?.value
      .trim();

  const capacity =
    number(
      $("registerVehicleCapacity")
        ?.value,
      0
    );

  if (!name) {
    if (message) {
      message.textContent =
        "Driver name is required.";
    }

    return;
  }

  if (!vehicleNumber) {
    if (message) {
      message.textContent =
        "Vehicle number is required.";
    }

    return;
  }

  if (capacity <= 0) {
    if (message) {
      message.textContent =
        "Vehicle capacity must be greater than 0 kg.";
    }

    return;
  }

  if (button) {
    button.disabled = true;

    button.textContent =
      "Registering...";
  }

  try {
    const vehiclesResponse =
      await api(
        "/api/v1/vehicles"
      );

    const vehicles =
      normalizeCollection(
        vehiclesResponse
      );

    let vehicle =
      vehicles.find(
        item =>
          String(
            item.vehicle_number ||
            item.number ||
            ""
          )
            .trim()
            .toLowerCase() ===
          vehicleNumber.toLowerCase()
      );

    if (!vehicle) {
      const vehicleResponse =
        await api(
          "/api/v1/vehicles/create",
          {
            method: "POST",

            body: JSON.stringify({
              vehicle_number:
                vehicleNumber,

              capacity_kg:
                capacity
            })
          }
        );

      vehicle =
        vehicleResponse.vehicle ||
        vehicleResponse;
    } else {
      const existingCapacity =
        number(
          vehicle.capacity_kg ??
          vehicle.max_weight_kg ??
          vehicle.max_capacity_kg,
          0
        );

      if (
        existingCapacity > 0 &&
        existingCapacity < capacity
      ) {
        throw new Error(
          `Vehicle ${vehicleNumber} already exists with ${existingCapacity} kg capacity.`
        );
      }
    }

    if (!vehicle?.id) {
      throw new Error(
        "Vehicle was not created or returned by the backend."
      );
    }

    const driverResponse =
      await api(
        "/api/v1/drivers/create",
        {
          method: "POST",

          body: JSON.stringify({
            name,

            phone:
              phone || null,

            license_number:
              licenseNumber ||
              null,

            vehicle_id:
              vehicle.id
          })
        }
      );

    const driver =
      driverResponse.driver ||
      driverResponse;

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
      new URL(
        window.location.href
      );

    url.searchParams.set(
      "driver_id",
      driver.id
    );

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
        "Unable to register driver.";
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

  const vehicleNumber =
    String(
      vehicle.vehicle_number ||
      vehicle.number ||
      ""
    ).trim().toLowerCase();

  const assigned =
    shipments.filter(
      shipment => {
        const assignment =
          shipment.assignment ||
          shipment.assigned ||
          {};

        const shipmentVehicle =
          shipment.vehicle ||
          assignment.vehicle ||
          {};

        const assignedVehicleId =
          shipment.vehicle_id ||
          shipment.assigned_vehicle_id ||
          shipmentVehicle.id ||
          assignment.vehicle_id;

        const assignedVehicleNumber =
          String(
            shipment.vehicle_number ||
            shipmentVehicle.vehicle_number ||
            assignment.vehicle_number ||
            ""
          ).trim().toLowerCase();

        const driverId =
          shipment.driver_id ||
          assignment.driver_id ||
          shipment.driver?.id ||
          assignment.driver?.id;

        const matchesVehicle =
          (assignedVehicleId &&
            String(assignedVehicleId) === vehicleId) ||
          (vehicleNumber &&
            assignedVehicleNumber === vehicleNumber);

        const matchesDriver =
          state.driver?.id &&
          driverId &&
          String(driverId) ===
            String(state.driver.id);

        return (
          (matchesVehicle || matchesDriver) &&
          !isCompletedShipment(shipment)
        );
      }
    );

  return (
    assigned.find(
      shipment =>
        String(
          shipment.status ||
          ""
        ).toLowerCase() ===
        "in_transit"
    ) ||
    assigned.find(
      shipment =>
        String(
          shipment.status ||
          ""
        ).toLowerCase() ===
        "assigned"
    ) ||
    assigned.find(
      shipment =>
        String(
          shipment.status ||
          ""
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
}

/* =========================================================
RENDER VEHICLE ONLY
========================================================= */

function renderVehicleOnly() {
  setText("shipmentId", "No Assignment");
  setText("shipmentStatus", "Waiting");

  const routeList = $("routeList");

  if (routeList) {
    routeList.innerHTML = `
      <div class="loading-state">
          <span>Waiting for shipment assignment...</span>
      </div>
    `;
  }

  disableNavigation();
}

/* =========================================================
SHOW INITIAL ERROR
========================================================= */

function showInitialError(message) {
  const routeList = $("routeList");

  if (routeList) {
    routeList.innerHTML = `
      <div class="error-state">
          <span class="error-icon">✗</span>
          <span>${escapeHtml(message)}</span>
      </div>
    `;
  }

  disableNavigation();
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
    const response =
      await api(
        `/api/v1/shipments/${shipmentId}/intelligence`
      );

    if (response?.intelligence) {
      const intelligence =
        response.intelligence;

        console.log("🔥 INTELLIGENCE RESPONSE:", intelligence);
        
      if (response.shipment) {
        state.shipment = {
          ...state.shipment,
          ...response.shipment
        };
      }

      if (response.vehicle) {
        state.vehicle = {
          ...state.vehicle,
          ...response.vehicle
        };
      }

      if (response.assignment) {
        state.shipment = {
          ...state.shipment,
          assignment:
            response.assignment
        };
      }

      const vehiclePosition =
        extractVehiclePosition({
          ...intelligence,

          vehicle_position:
            response.vehicle?.latitude !== undefined
              ? {
                  latitude:
                    response.vehicle.latitude,

                  longitude:
                    response.vehicle.longitude
                }
              : intelligence.vehicle_position
        });

      if (vehiclePosition) {
        updateVehicleMarker(
          vehiclePosition.lat,
          vehiclePosition.lon
        );
      }

      return intelligence;
    }

    return response;
  } catch (primaryError) {
    console.warn(
      "Primary intelligence endpoint unavailable.",
      primaryError.message
    );
  }

  const fallback =
    await api(
      `/api/v1/routes/optimize?shipment_id=${shipmentId}`
    );

  return fallback?.intelligence ||
    fallback;
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


function extractRoutes(intelligence) {
  if (!intelligence) {
    return [];
  }

  // First use the actual selected route
  if (
    intelligence.selected_route &&
    typeof intelligence.selected_route === "object"
  ) {
    const selected = intelligence.selected_route;

    const alternatives = Array.isArray(
      intelligence.alternative_routes
    )
      ? intelligence.alternative_routes
      : [];

    return [selected, ...alternatives];
  }

  // Then check other possible route arrays
  const candidates = [
    intelligence.routes,
    intelligence.route_options,
    intelligence.alternatives,
    intelligence.traffic_routes,
    intelligence.routeAlternatives
  ];

  for (const routes of candidates) {
    if (Array.isArray(routes) && routes.length > 0) {
      return routes;
    }
  }

  // Last fallback
  if (
    intelligence.route &&
    typeof intelligence.route === "object"
  ) {
    return [intelligence.route];
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
    route.estimated_time_minutes ??
    route.duration_minutes ??
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
  number(
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
  if (
    level === "dangerous"
  ) {
    return "#ef4444";
  }

  if (
    level === "moderate"
  ) {
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
    (1 - route.risk) * 100
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
            : 0.55
      });

      if (selected) {
        state.selectedRouteLayer =
          item.layer;
      }
    }
  );
}

/* =========================================================
NAVIGATION BUTTONS
========================================================= */

function enableNavigation() {
  const startButton =
    $("startNavigationButton");

  const stopButton =
    $("stopNavigationButton");

  if (startButton) {
    startButton.disabled =
      !state.selectedRoute;
  }

  if (stopButton) {
    stopButton.disabled =
      !state.navigationStarted;
  }
}

function disableNavigation() {
  const startButton =
    $("startNavigationButton");

  if (startButton) {
    startButton.disabled =
      true;
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
  state.navigationStarted = false;

  hide("navigationBanner");
  hide("stopNavigationButton");

  show("startNavigationButton");
  hide("deliverButton");

  setText(
    "shipmentStatus",
    "Assigned"
  );

  stopGpsTracking();

  setConnection(
    "connected",
    "Navigation Stopped"
  );
}

/* =========================================================
START GPS TRACKING
========================================================= */

function startGpsTracking() {

  if (!navigator.geolocation) {
    setConnection("error", "Geolocation is not supported on this device.");
    return;
  }

  setConnection("connecting", "Requesting GPS location...");

  state.gpsWatchId = navigator.geolocation.watchPosition(
    handleGpsPosition,
    handleGpsError,
    CONFIG.GPS_OPTIONS
  );
}

/* =========================================================
STOP GPS TRACKING
========================================================= */

function stopGpsTracking() {
  if (state.gpsWatchId !== null) {
    navigator.geolocation.clearWatch(state.gpsWatchId);
    state.gpsWatchId = null;
  }
}

/* =========================================================
HANDLE GPS POSITION
========================================================= */

function handleGpsPosition(position) {
  const { latitude, longitude } = position.coords;

  state.previousPosition = state.currentPosition;
  state.currentPosition = { lat: latitude, lon: longitude };

  updateVehicleMarker(latitude, longitude);

  const now = Date.now();
  if (now - state.lastGpsSentAt >= CONFIG.GPS_SEND_INTERVAL) {
    sendGpsToBackend(latitude, longitude);
    state.lastGpsSentAt = now;
  }
}

/* =========================================================
HANDLE GPS ERROR
========================================================= */

function handleGpsError(error) {
  console.warn("GPS Error:", error.message);

  const messages = {
    1: "Location permission denied. Enable in settings.",
    2: "Location unavailable. Check signal.",
    3: "Location request timed out. Try again."
  };

  const message = messages[error.code] || "GPS error: " + error.message;

  setConnection("error", message);
}

/* =========================================================
SEND GPS TO BACKEND
========================================================= */

async function sendGpsToBackend(latitude, longitude) {
  try {
    const vehicleId = encodeURIComponent(state.vehicle.id);

    await api(
      `/api/v1/vehicles/${vehicleId}/update-location`,
      {
        method: "POST",

        body: JSON.stringify({
          latitude,
          longitude,
          status: state.navigationStarted ? "in_transit" : "available"
        })
      }
    );
  } catch (error) {
    console.warn("Failed to send GPS location:", error.message);
  }
}

/* =========================================================
START AUTO REFRESH
========================================================= */

function startAutoRefresh() {
  state.refreshTimer = setInterval(
    () => {
      refreshIntelligence();
    },
    CONFIG.REFRESH_INTERVAL
  );
}

/* =========================================================
MARK DELIVERED
========================================================= */

async function markDelivered() {
  if (!state.shipment) {
    return;
  }

  const confirmed = confirm("Mark shipment as delivered?");

  if (!confirmed) {
    return;
  }

  try {
    const shipmentId = encodeURIComponent(state.shipment.id);

    await api(
      `/api/v1/shipments/${shipmentId}/mark-delivered`,
      {
        method: "POST",

        body: JSON.stringify({
          status: "delivered"
        })
      }
    );

    setText("shipmentStatus", "Delivered");

    show("deliveryModal");

    stopNavigation();

    setConnection("connected", "Delivery Confirmed");
  } catch (error) {
    alert("Failed to mark delivered: " + error.message);
  }
}

/* =========================================================
CHECK FOR REROUTE
========================================================= */

function checkForReroute(intelligence) {
  const currentRisk = normalizeRisk(
    intelligence.risk_percent ??
    intelligence.risk_score ??
    intelligence.risk
  );

  const selectedRisk = normalizeRisk(
    state.selectedRoute?.risk ?? 0
  );

  if (currentRisk > 0.65 && currentRisk > selectedRisk + 0.15) {
    state.reroutePending = true;

    show("rerouteModal");
  }
}

/* =========================================================
ACCEPT REROUTE
========================================================= */

async function acceptReroute() {
  const safest = chooseSafestRoute(state.routes);

  if (safest) {
    await selectRoute(safest, true);
  }

  state.reroutePending = false;

  hide("rerouteModal");
}

/* =========================================================
KEEP CURRENT ROUTE
========================================================= */

function keepCurrentRoute() {
  state.reroutePending = false;

  hide("rerouteModal");
}

/* =========================================================
JOURNEY STATS
========================================================= */

function updateJourneyStats(
  intelligence
) {
  const route =
    intelligence.selected_route ||
    intelligence.selectedRoute ||
    intelligence.route ||
    state.selectedRoute;

  const distance =
    number(
      intelligence.distance_km ??
      intelligence.distance ??
      route?.distance_km ??
      route?.distance ??
      state.selectedRoute?.distance
    );

  const duration =
    number(
      intelligence.estimated_time_minutes ??
      intelligence.eta_minutes ??
      intelligence.duration_minutes ??
      route?.duration_minutes ??
      route?.duration ??
      state.selectedRoute?.duration
    );

  setText(
    "distanceValue",
    distance > 0
      ? `${distance.toFixed(1)} km`
      : "--"
  );

  setText(
    "etaValue",
    duration > 0
      ? formatMinutes(
          duration
        )
      : "--"
  );

  const speed =
    number(
      state.vehicle?.speed_kmh ??
      state.vehicle?.speed ??
      intelligence.speed_kmh
    );

  setText(
    "speedValue",
    speed > 0
      ? `${Math.round(speed)} km/h`
      : "--"
  );
}

/* =========================================================
RISK DISPLAY
========================================================= */

function updateRisk(intelligence) {
  if (!intelligence) {
    return;
  }

  /*
   * Main AI risk
   * Backend currently returns:
   * risk_percent
   * risk_score
   * risk_level
   */

  const weather =
    intelligence.weather || {};

  const weatherRisk =
    weather.risk || {};

  const selectedRoute =
    intelligence.selected_route ||
    intelligence.selectedRoute ||
    state.selectedRoute ||
    {};

  const rawRisk =
    intelligence.risk_percent ??
    intelligence.risk_percentage ??
    intelligence.risk_score ??
    intelligence.disruption_risk ??
    intelligence.risk ??
    selectedRoute.risk_percent ??
    selectedRoute.risk_score ??
    selectedRoute.risk;

  const risk =
    normalizeRisk(rawRisk);

  const percent =
    Math.round(risk * 100);

  const level =
    normalizeRiskLevel(
      intelligence.risk_level ??
      intelligence.riskLevel ??
      weatherRisk.risk_level ??
      risk
    );

  /*
   * AI RISK SCORE
   */

  setText(
    "riskScore",
    `${percent}%`
  );

  /*
   * RISK LEVEL
   */

  setText(
    "riskLevel",
    riskLabel(level)
  );

  const riskScore =
    $("riskScore");

  if (riskScore) {
    riskScore.classList.remove(
      "safe",
      "moderate",
      "dangerous"
    );

    riskScore.classList.add(
      level
    );
  }

  const riskLevel =
    $("riskLevel");

  if (riskLevel) {
    riskLevel.classList.remove(
      "safe",
      "moderate",
      "dangerous"
    );

    riskLevel.classList.add(
      level
    );
  }

  /*
   * RISK PROGRESS BAR
   */

  const riskProgress =
    $("riskProgress");

  if (riskProgress) {
    riskProgress.style.width =
      `${percent}%`;

    riskProgress.className =
      `risk-progress-fill ${level}`;
  }

  /*
   * WEATHER RISK
   */

  const weatherRiskPercent =
    weatherRisk.risk_percent ??
    weatherRisk.risk_score ??
    weather.risk_percent ??
    weather.risk_score;

  if (
    weatherRiskPercent !== undefined &&
    weatherRiskPercent !== null
  ) {
    const weatherPercent =
      Math.round(
        normalizeRisk(
          weatherRiskPercent
        ) * 100
      );

    const weatherStatus =
      weather.status === "FALLBACK"
        ? `${weatherPercent}% · Fallback`
        : `${weatherPercent}%`;

    setText(
      "weatherRisk",
      weatherStatus
    );
  } else {
    setText(
      "weatherRisk",
      "Unavailable"
    );
  }

  /*
   * TRAFFIC
   */

  const trafficAvailable =
    selectedRoute.traffic_available ??
    intelligence.traffic_available;

  const trafficLevel =
    selectedRoute.traffic_level ??
    intelligence.traffic_level;

  if (
    trafficAvailable === false ||
    trafficLevel === "unknown"
  ) {
    setText(
      "trafficRisk",
      "Unavailable"
    );
  } else if (trafficLevel) {
    setText(
      "trafficRisk",
      formatStatus(
        trafficLevel
      )
    );
  } else {
    const trafficScore =
      selectedRoute.traffic_score ??
      selectedRoute.traffic;

    if (
      trafficScore !== undefined &&
      trafficScore !== null
    ) {
      const trafficPercent =
        Math.round(
          normalizeRisk(
            trafficScore
          ) * 100
        );

      setText(
        "trafficRisk",
        `${trafficPercent}%`
      );
    } else {
      setText(
        "trafficRisk",
        "Unavailable"
      );
    }
  }

  /*
   * ROAD ACCESSIBILITY
   */

  const roadAccessibility =
    intelligence.road_accessibility_percent ??
    selectedRoute.accessibility_percent ??
    selectedRoute.accessibility_score ??
    selectedRoute.accessibility;

  const roadCondition =
    intelligence.route_condition ??
    selectedRoute.condition;

  if (
    roadAccessibility !== undefined &&
    roadAccessibility !== null &&
    Number(roadAccessibility) > 0
  ) {
    let accessibility =
      Number(roadAccessibility);

    if (accessibility <= 1) {
      accessibility *= 100;
    }

    accessibility =
      Math.round(
        clamp(
          accessibility,
          0,
          100
        )
      );

    setText(
      "roadRisk",
      `${accessibility}% Accessible`
    );
  } else if (roadCondition) {
    setText(
      "roadRisk",
      formatStatus(
        roadCondition
      )
    );
  } else {
    setText(
      "roadRisk",
      "Unavailable"
    );
  }

  /*
   * MISSION RISK
   */

  updateMissionRisk(
    percent,
    level
  );
}

/* =========================================================
MISSION RISK
========================================================= */

function updateMissionRisk(
  percent,
  level
) {
  setText(
    "missionRisk",
    `${percent}%`
  );

  setText(
    "missionRiskLabel",
    riskLabel(
      level
    )
  );

  const element =
    $("missionRisk");

  if (element) {
    element.classList.remove(
      "safe",
      "moderate",
      "dangerous"
    );

    element.classList.add(
      level
    );
  }
}

function riskLabel(
  level
) {
  if (
    level === "dangerous"
  ) {
    return "High Risk";
  }

  if (
    level === "moderate"
  ) {
    return "Moderate Risk";
  }

  return "Low Risk";
}

/* =========================================================
WEATHER
========================================================= */

function updateWeather(
  weather
) {
  if (!weather) {
    return;
  }

  const temperature =
    weather.temperature_c ??
    weather.temperature ??
    weather.temp_c ??
    weather.temp;

  const condition =
    weather.condition ||
    weather.description ||
    weather.weather ||
    weather.summary;

  const rainfall =
    weather.rainfall_mm ??
    weather.rain_mm ??
    weather.precipitation_mm;

  const humidity =
    weather.humidity_percent ??
    weather.humidity;

  setText(
    "weatherTemperature",
    temperature !== undefined &&
    temperature !== null
      ? `${number(
          temperature
        ).toFixed(1)}°C`
      : "--"
  );

  setText(
    "weatherCondition",
    condition ||
      "Unknown"
  );

  setText(
    "weatherRainfall",
    rainfall !== undefined &&
    rainfall !== null
      ? `${number(
          rainfall
        ).toFixed(1)} mm`
      : "--"
  );

  setText(
    "weatherHumidity",
    humidity !== undefined &&
    humidity !== null
      ? `${Math.round(
          number(humidity)
        )}%`
      : "--"
  );
}

/* =========================================================
ALERTS
========================================================= */

function updateAlerts(
  intelligence
) {
  const weather =
    intelligence.weather;

  updateWeather(
    weather
  );

  const alerts =
    [];

  if (
    Array.isArray(
      intelligence.alerts
    )
  ) {
    alerts.push(
      ...intelligence.alerts
    );
  }

  if (
    Array.isArray(
      intelligence.weather_alerts
    )
  ) {
    alerts.push(
      ...intelligence.weather_alerts
    );
  }

  if (
    intelligence.alert
  ) {
    alerts.push(
      intelligence.alert
    );
  }

  if (
    weather?.alert
  ) {
    alerts.push(
      weather.alert
    );
  }

  renderAlerts(
    alerts
  );
}

/* =========================================================
RENDER ALERTS
========================================================= */

function renderAlerts(
  alerts
) {
  const container =
    $("alertsList");

  if (!container) {
    return;
  }

  const normalized =
    alerts
      .filter(Boolean)
      .map(
        normalizeAlert
      );

  if (!normalized.length) {
    container.innerHTML = `
      <div class="alert-empty">
          <span class="alert-icon">
              ✓
          </span>
          <span>
              No active disruption alerts
          </span>
      </div>
    `;

    return;
  }

  container.innerHTML =
    normalized
      .slice(0, 5)
      .map(
        alert =>
          alertHtml(
            alert
          )
      )
      .join("");
}

function normalizeAlert(
  alert
) {
  if (
    typeof alert === "string"
  ) {
    return {
      title:
        "Disruption Alert",

      message:
        alert,

      level:
        "warning"
    };
  }

  return {
    title:
      alert.title ||
      alert.name ||
      alert.type ||
      "Disruption Alert",

    message:
      alert.message ||
      alert.description ||
      alert.details ||
      "Potential route disruption detected.",

    level:
      normalizeAlertLevel(
        alert.level ||
        alert.severity ||
        alert.status
      )
  };
}

function normalizeAlertLevel(
  value
) {
  const text =
    String(
      value || ""
    ).toLowerCase();

  if (
    text.includes("critical") ||
    text.includes("danger") ||
    text.includes("high")
  ) {
    return "danger";
  }

  if (
    text.includes("medium") ||
    text.includes("moderate") ||
    text.includes("warning")
  ) {
    return "warning";
  }

  return "info";
}

function alertHtml(
  alert
) {
  return `
    <div class="alert-card ${escapeHtml(
      alert.level
    )}">
        <div class="alert-card-icon">
            ${
              alert.level === "danger"
                ? "⚠"
                : alert.level === "warning"
                    ? "!"
                    : "i"
            }
        </div>

        <div class="alert-card-content">
            <strong>
                ${escapeHtml(
                  alert.title
                )}
            </strong>

            <span>
                ${escapeHtml(
                  alert.message
                )}
            </span>
        </div>
    </div>
  `;
}

/* =========================================================
NAVIGATION INSTRUCTION
========================================================= */

function updateNavigationInstruction(
  intelligence
) {
  const instruction =
    intelligence.next_instruction ||
    intelligence.navigation_instruction ||
    intelligence.instruction ||
    intelligence.next_turn;

  if (!instruction) {
    return;
  }

  setText(
    "navigationInstruction",
    instruction
  );

  const distance =
    intelligence.next_instruction_distance_m ??
    intelligence.next_turn_distance_m ??
    intelligence.maneuver_distance_m;

  if (
    distance !== undefined &&
    distance !== null
  ) {
    setText(
      "instructionDistance",
      formatDistance(
        distance
      )
    );
  }
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
    intelligence.position,
    intelligence.vehicle,
    state.vehicle
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
      13,
      {
        animate: true
      }
    );
  }
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
FORMAT HELPERS
========================================================= */

function formatMinutes(minutes) {
  const mins = Math.round(minutes);

  if (mins < 60) {
    return `${mins} min`;
  }

  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;

  if (remainder === 0) {
    return `${hours}h`;
  }

  return `${hours}h ${remainder}m`;
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }

  return `${(meters / 1000).toFixed(1)}km`;
}

function formatStatus(status) {
  if (!status) {
    return "--";
  }

  return String(status)
    .split("_")
    .map(
      word =>
        word.charAt(0).toUpperCase() +
        word.slice(1).toLowerCase()
    )
    .join(" ");
}

function riskTextClass(level) {
  if (level === "dangerous") {
    return "text-red";
  }

  if (level === "moderate") {
    return "text-yellow";
  }

  return "text-green";
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
    stopNavigation
};
