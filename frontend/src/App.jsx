
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CloudRain,
  Crosshair,
  Gauge,
  LayoutDashboard,
  MapPin,
  Package,
  Plus,
  Radio,
  RefreshCw,
  Route as RouteIcon,
  Search,
  ShieldAlert,
  Truck,
  X,
  Navigation,
  Clock3,
  Ban,
  LocateFixed,
  Zap,
} from "lucide-react";

import {
  MapContainer,
  Marker,
  Popup,
  Polyline,
  TileLayer,
  useMap,
} from "react-leaflet";

import L from "leaflet";
import "./App.css";


/* =========================================================
   API CONFIGURATION
   ========================================================= */

const API_ROOT =
  import.meta.env.VITE_API_URL ||
  "http://localhost:8000";

const API_BASE = `${API_ROOT}/api/v1`;

const WS_BASE = API_ROOT.replace(/^http/, "ws");

const api = axios.create({
  baseURL: API_BASE,
  timeout: 20000,
});


/* =========================================================
   MAP CONFIGURATION
   ========================================================= */

const NER_CENTER = [25.6, 91.9];

const NER_BOUNDS = [
  [21.7, 87.9],
  [29.6, 97.5],
];

const STATES = [
  "Assam",
  "Arunachal Pradesh",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Sikkim",
  "Tripura",
];

const WAREHOUSE = {
  name: "Guwahati Logistics Hub",
  lat: 26.1445,
  lon: 91.7362,
};

const DEMO_LOCATIONS = [
  {
    name: "Guwahati, Assam",
    lat: 26.1445,
    lon: 91.7362,
  },
  {
    name: "Shillong, Meghalaya",
    lat: 25.5788,
    lon: 91.8933,
  },
  {
    name: "Imphal, Manipur",
    lat: 24.817,
    lon: 93.9368,
  },
  {
    name: "Kohima, Nagaland",
    lat: 25.6751,
    lon: 94.1086,
  },
  {
    name: "Aizawl, Mizoram",
    lat: 23.7271,
    lon: 92.7176,
  },
  {
    name: "Agartala, Tripura",
    lat: 23.8315,
    lon: 91.2868,
  },
  {
    name: "Itanagar, Arunachal Pradesh",
    lat: 27.0844,
    lon: 93.6053,
  },
  {
    name: "Gangtok, Sikkim",
    lat: 27.3389,
    lon: 88.6065,
  },
];


/* =========================================================
   MAP ICONS
   ========================================================= */

const icon = (emoji, cls = "map-icon") =>
  L.divIcon({
    className: "",
    html: `<div class="${cls}">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  });

const truckIcon = icon(
  "🚚",
  "map-icon vehicle-marker"
);

const destinationIcon = icon(
  "📦",
  "map-icon destination-marker"
);

const warehouseIcon = icon(
  "🏭",
  "map-icon warehouse-marker"
);

const startIcon = icon(
  "●",
  "map-icon start-marker"
);


/* =========================================================
   HELPERS
   ========================================================= */

function normalizeStatus(value) {
  return String(value ?? "").toUpperCase();
}


function riskClass(risk = 0) {
  const n = Number(risk);

  if (n >= 75) return "critical";
  if (n >= 60) return "high";
  if (n >= 40) return "moderate";

  return "low";
}


function getRouteCoords(item) {
  const intelligence =
    item?.intelligence || {};

  const route =
    intelligence?.selected_route ||
    intelligence?.route ||
    {};

  let geometry =
    intelligence?.route_geometry ||
    route?.route_geometry ||
    route?.geometry ||
    route?.coordinates ||
    [];

  // GeoJSON Feature
  if (
    geometry &&
    geometry.type === "Feature"
  ) {
    geometry =
      geometry.geometry;
  }

  // GeoJSON Geometry
  if (
    geometry &&
    geometry.type === "LineString"
  ) {
    geometry =
      geometry.coordinates || [];
  }

  // GeoJSON FeatureCollection
  if (
    geometry &&
    geometry.type ===
      "FeatureCollection"
  ) {
    const feature =
      geometry.features?.find(
        (feature) =>
          feature?.geometry?.type ===
          "LineString"
      );

    geometry =
      feature?.geometry?.coordinates ||
      [];
  }

  if (!Array.isArray(geometry)) {
    return [];
  }

  return geometry
    .map((point) => {
      // GeoJSON: [longitude, latitude]
      if (
        Array.isArray(point) &&
        point.length >= 2
      ) {
        const lon = Number(point[0]);
        const lat = Number(point[1]);

        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon)
        ) {
          return [lat, lon];
        }
      }

      // Backend may return:
      // { lat, lon }
      if (
        point &&
        point.lat != null &&
        point.lon != null
      ) {
        const lat = Number(point.lat);
        const lon = Number(point.lon);

        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon)
        ) {
          return [lat, lon];
        }
      }

      // Backend may return:
      // { latitude, longitude }
      if (
        point &&
        point.latitude != null &&
        point.longitude != null
      ) {
        const lat = Number(
          point.latitude
        );

        const lon = Number(
          point.longitude
        );

        if (
          Number.isFinite(lat) &&
          Number.isFinite(lon)
        ) {
          return [lat, lon];
        }
      }

      return null;
    })
    .filter(Boolean);
}


function formatEta(minutes) {
  if (
    minutes == null ||
    !Number.isFinite(Number(minutes))
  ) {
    return "—";
  }

  const m = Math.round(Number(minutes));

  return m >= 60
    ? `${Math.floor(m / 60)}h ${m % 60}m`
    : `${m} min`;
}


function formatTime(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}


function errorText(error) {
  const detail =
    error?.response?.data?.detail;

  if (Array.isArray(detail)) {
    return detail
      .map(
        (item) =>
          item?.msg ||
          JSON.stringify(item)
      )
      .join(", ");
  }

  return (
    detail ||
    error?.message ||
    "Request failed"
  );
}


/* =========================================================
   HEADER
   ========================================================= */

function Header({
  updatedAt,
  onRefresh,
  refreshing,
}) {
  return (
    <header className="topbar">
      <div>
        <div className="eyebrow">
          <span className="live-dot" />
          LIVE CONTROL ROOM
        </div>

        <h1>
          Disaster-Aware Logistics
        </h1>

        <p>
          North Eastern Region · Smart route
          intelligence
        </p>
      </div>

      <div className="topbar-actions">
        <div className="sync-pill">
          <Radio size={14} />

          Live

          <span>
            {formatTime(updatedAt)}
          </span>
        </div>

        <button
          className="icon-btn"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh intelligence"
        >
          <RefreshCw
            size={17}
            className={
              refreshing ? "spin" : ""
            }
          />
        </button>
      </div>
    </header>
  );
}


/* =========================================================
   SIDEBAR
   ========================================================= */

function Sidebar({
  page,
  setPage,
}) {
  const items = [
    [
      "dashboard",
      "Control Room",
      LayoutDashboard,
    ],
    [
      "shipments",
      "Shipments",
      Package,
    ],
    [
      "vehicles",
      "Vehicles",
      Truck,
    ],
    [
      "analytics",
      "Analytics",
      BarChart3,
    ],
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          DAL
        </div>

        <div>
          <strong>NEXORA</strong>
          <small>
            Smart Logistics
          </small>
        </div>
      </div>

      <div className="sidebar-live">
        <span className="live-dot" />
        SYSTEM LIVE
      </div>

      <nav>
        {items.map(
          ([id, label, Icon]) => (
            <button
              key={id}
              className={`nav-item ${
                page === id
                  ? "active"
                  : ""
              }`}
              onClick={() =>
                setPage(id)
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </button>
          )
        )}
      </nav>

      <div className="sidebar-footer">
        <ShieldAlert size={16} />

        <span>
          Disaster intelligence
          <br />
          <b>MONITORING ACTIVE</b>
        </span>
      </div>
    </aside>
  );
}


/* =========================================================
   STAT CARD
   ========================================================= */

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  danger,
}) {
  return (
    <div
      className={`stat-card ${
        danger ? "stat-danger" : ""
      }`}
    >
      <div className="stat-icon">
        <Icon size={18} />
      </div>

      <div>
        <div className="stat-label">
          {label}
        </div>

        <div className="stat-value">
          {value}
        </div>

        {sub && (
          <div className="stat-sub">
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}


/* =========================================================
   RISK BADGE
   ========================================================= */

function RiskBadge({
  value,
}) {
  const n = Math.round(
    Number(value || 0)
  );

  const cls = riskClass(n);

  return (
    <span
      className={`risk-badge ${cls}`}
    >
      {n}% {cls}
    </span>
  );
}


/* =========================================================
   MAP CONTROLLER
   ========================================================= */

function MapController({
  selected,
  items,
  vehicles,
  follow,
}) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
  }, [map]);

  useEffect(() => {
    if (
      !follow ||
      !selected?.vehicle
    ) {
      return;
    }

    const {
      latitude,
      longitude,
    } = selected.vehicle;

    if (
      latitude != null &&
      longitude != null
    ) {
      map.setView(
        [
          Number(latitude),
          Number(longitude),
        ],
        Math.max(
          map.getZoom(),
          14
        ),
        {
          animate: true,
        }
      );
    }
  }, [
    selected,
    follow,
    map,
  ]);

  useEffect(() => {
    window.__dalFitMap = () => {
      const points = [];

      vehicles.forEach((vehicle) => {
        if (
          vehicle.latitude != null &&
          vehicle.longitude != null
        ) {
          points.push([
            Number(vehicle.latitude),
            Number(vehicle.longitude),
          ]);
        }
      });

      items.forEach((shipment) => {
        if (shipment.origin) {
          points.push([
            Number(
              shipment.origin.lat
            ),
            Number(
              shipment.origin.lon
            ),
          ]);
        }

        if (shipment.destination) {
          points.push([
            Number(
              shipment.destination.lat
            ),
            Number(
              shipment.destination.lon
            ),
          ]);
        }

        const coords =
          getRouteCoords(shipment);

        coords.forEach((point) =>
          points.push(point)
        );
      });

      if (points.length > 1) {
        map.fitBounds(points, {
          padding: [55, 55],
          maxZoom: 12,
          animate: true,
        });
      } else if (
        points.length === 1
      ) {
        map.setView(
          points[0],
          14,
          {
            animate: true,
          }
        );
      }
    };

    window.__dalFocusShipment = (
      shipment
    ) => {
      const coords = [];

      if (
        shipment?.vehicle?.latitude != null
      ) {
        coords.push([
          Number(
            shipment.vehicle.latitude
          ),
          Number(
            shipment.vehicle.longitude
          ),
        ]);
      }

      const route =
        getRouteCoords(shipment);

      route.forEach((point) =>
        coords.push(point)
      );

      if (coords.length > 1) {
        map.fitBounds(coords, {
          padding: [60, 60],
          maxZoom: 15,
          animate: true,
        });
      } else if (
        coords.length === 1
      ) {
        map.setView(
          coords[0],
          15,
          {
            animate: true,
          }
        );
      }
    };
  }, [
    items,
    vehicles,
    map,
  ]);

  return null;
}


/* =========================================================
   TRAFFIC COLOR
   ========================================================= */

function trafficColor(level) {
  const value =
    String(level || "").toLowerCase();

  if (value === "severe")
    return "#b91c1c";

  if (value === "heavy")
    return "#ea580c";

  if (value === "moderate")
    return "#eab308";

  if (value === "free")
    return "#16a34a";

  return "#64748b";
}


/* =========================================================
   SMART MAP
   ========================================================= */

function SmartMap({
  items,
  vehicles,
  selected,
  setSelected,
  follow,
  setFollow,
}) {
  const selectedCoords =
    selected
      ? getRouteCoords(selected)
      : [];

  const selectedTraffic =
    selected?.intelligence?.traffic ||
    {};

  const trafficSegments =
    selectedTraffic?.traffic_segments ||
    [];

  const selectedRisk =
    riskClass(
      selected?.intelligence
        ?.risk_percent
    );

  return (
    <div className="map-shell">
      <div className="map-header">
        <div>
          <span className="section-kicker">
            <Activity size={13} />
            LIVE GEOSPATIAL INTELLIGENCE
          </span>

          <h2>
            Fleet & Route Map
          </h2>

          <small className="map-subline">
            {
              vehicles.filter(
                (vehicle) =>
                  vehicle.latitude !=
                    null &&
                  vehicle.longitude !=
                    null
              ).length
            }{" "}
            GPS vehicles ·
            {items.length} active
            shipments ·
            {selectedTraffic.available
              ? " live traffic connected"
              : " traffic provider not configured"}
          </small>
        </div>

        <div className="map-actions">
          <button
            onClick={() =>
              window.__dalFitMap?.()
            }
          >
            <LocateFixed size={14} />
            Fit fleet
          </button>

          {selected && (
            <button
              onClick={() =>
                window.__dalFocusShipment?.(
                  selected
                )
              }
            >
              <Navigation size={14} />
              Focus route
            </button>
          )}

          <button
            className={
              follow ? "active" : ""
            }
            onClick={() =>
              setFollow(
                (value) => !value
              )
            }
          >
            <Crosshair size={14} />
            Follow vehicle
          </button>
        </div>
      </div>

      <div className="map-container">
        <MapContainer
          center={NER_CENTER}
          zoom={7}
          minZoom={6}
          maxZoom={18}
          maxBounds={NER_BOUNDS}
          maxBoundsViscosity={0.65}
          scrollWheelZoom
          zoomControl
          attributionControl
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
            maxZoom={19}
          />

          <MapController
            selected={selected}
            items={items}
            vehicles={vehicles}
            follow={follow}
          />

          <Marker
            position={[
              WAREHOUSE.lat,
              WAREHOUSE.lon,
            ]}
            icon={warehouseIcon}
          >
            <Popup>
              <b>
                {WAREHOUSE.name}
              </b>
              <br />
              Central dispatch hub ·
              Assam
            </Popup>
          </Marker>

          {/* =================================================
              ALL VEHICLES
             ================================================= */}

          {vehicles.map((vehicle) => {
            if (
              vehicle.latitude ==
                null ||
              vehicle.longitude ==
                null
            ) {
              return null;
            }

            const assigned =
              items.find(
                (shipment) =>
                  shipment.vehicle?.id ===
                  vehicle.id
              );

            const isSelected =
              selected?.vehicle?.id ===
              vehicle.id;

            return (
              <Marker
                key={`vehicle-${vehicle.id}`}
                position={[
                  Number(
                    vehicle.latitude
                  ),
                  Number(
                    vehicle.longitude
                  ),
                ]}
                icon={truckIcon}
                zIndexOffset={
                  isSelected
                    ? 1000
                    : 500
                }
                eventHandlers={{
                  click: () =>
                    assigned &&
                    setSelected(
                      assigned
                    ),
                }}
              >
                <Popup>
                  <b>
                    {
                      vehicle.vehicle_number
                    }
                  </b>
                  <br />
                  Status:{" "}
                  {normalizeStatus(
                    vehicle.status
                  ).replace(
                    "_",
                    " "
                  )}
                  <br />
                  GPS:{" "}
                  {Number(
                    vehicle.latitude
                  ).toFixed(6)}
                  ,{" "}
                  {Number(
                    vehicle.longitude
                  ).toFixed(6)}
                  <br />
                  Speed:{" "}
                  {vehicle.speed_kmh ??
                    "—"}{" "}
                  km/h
                  <br />
                  Source:{" "}
                  {vehicle.source ||
                    "database"}
                  <br />
                  Updated:{" "}
                  {formatTime(
                    vehicle.last_updated
                  )}

                  {assigned && (
                    <>
                      <br />
                      <b>
                        Shipment: #
                        {assigned.id.slice(
                          0,
                          8
                        )}
                      </b>
                    </>
                  )}
                </Popup>
              </Marker>
            );
          })}

          {/* =================================================
              DESTINATIONS
             ================================================= */}

          {items.map(
            (shipment) => (
              <Marker
                key={`destination-${shipment.id}`}
                position={[
                  Number(
                    shipment.destination
                      .lat
                  ),
                  Number(
                    shipment.destination
                      .lon
                  ),
                ]}
                icon={destinationIcon}
                eventHandlers={{
                  click: () =>
                    setSelected(
                      shipment
                    ),
                }}
              >
                <Popup>
                  <b>
                    Shipment #
                    {shipment.id.slice(
                      0,
                      8
                    )}
                  </b>
                  <br />

                  {String(
                    shipment.category
                  ).toUpperCase()}{" "}
                  ·{" "}
                  {normalizeStatus(
                    shipment.status
                  ).replace(
                    "_",
                    " "
                  )}

                  <br />

                  Risk:{" "}
                  {shipment
                    .intelligence
                    ?.risk_percent !=
                  null
                    ? `${Math.round(
                        shipment
                          .intelligence
                          .risk_percent
                      )}%`
                    : "—"}
                </Popup>
              </Marker>
            )
          )}

          {/* =================================================
              OTHER ACTIVE ROUTES
             ================================================= */}

          {items
            .filter(
              (shipment) =>
                !selected ||
                shipment.id !==
                  selected.id
            )
            .map((shipment) => {
              const coords =
                getRouteCoords(
                  shipment
                );

              if (
                coords.length < 2
              ) {
                return null;
              }

              return (
                <Polyline
                  key={`route-${shipment.id}`}
                  positions={coords}
                  pathOptions={{
                    color:
                      riskClass(
                        shipment
                          .intelligence
                          ?.risk_percent
                      ) === "low"
                        ? "#94a3b8"
                        : "#f59e0b",
                    weight: 3,
                    opacity: 0.45,
                    dashArray:
                      "7 7",
                  }}
                />
              );
            })}

          {/* =================================================
              SELECTED TRAFFIC ROUTE
             ================================================= */}

          {selected &&
          trafficSegments.length >
            0 ? (
            trafficSegments
              .slice(0, 350)
              .map((segment) => (
                <Polyline
                  key={`traffic-${selected.id}-${segment.index}`}
                  positions={[
                    [
                      Number(
                        segment.from
                          .lat
                      ),
                      Number(
                        segment.from
                          .lon
                      ),
                    ],
                    [
                      Number(
                        segment.to
                          .lat
                      ),
                      Number(
                        segment.to
                          .lon
                      ),
                    ],
                  ]}
                  pathOptions={{
                    color:
                      trafficColor(
                        segment.congestion
                      ),
                    weight: 7,
                    opacity: 0.9,
                  }}
                />
              ))
          ) : selectedCoords.length >
            1 ? (
            <Polyline
              positions={
                selectedCoords
              }
              pathOptions={{
                color:
                  selectedRisk ===
                  "low"
                    ? "#159447"
                    : selectedRisk ===
                      "moderate"
                    ? "#d08a00"
                    : "#d93636",
                weight: 7,
                opacity: 0.9,
              }}
            />
          ) : null}

          {/* =================================================
              ALTERNATIVE ROUTES
             ================================================= */}

          {selected?.intelligence?.alternative_routes?.map(
            (route) => {
              const coords =
                getRouteCoords({
                  intelligence: {
                    selected_route:
                      route,
                  },
                });

              if (
                coords.length < 2
              ) {
                return null;
              }

              return (
                <Polyline
                  key={`alternative-${selected.id}-${route.route_index}`}
                  positions={coords}
                  pathOptions={{
                    color:
                      "#64748b",
                    weight: 4,
                    opacity: 0.5,
                    dashArray:
                      "12 9",
                  }}
                />
              );
            }
          )}

          {/* =================================================
              SELECTED ROUTE ORIGIN
             ================================================= */}

          {selected && (
            <>
              <Marker
                position={[
                  Number(
                    selected
                      .intelligence
                      ?.origin_for_route
                      ?.lat ??
                      selected
                        .origin.lat
                  ),
                  Number(
                    selected
                      .intelligence
                      ?.origin_for_route
                      ?.lon ??
                      selected
                        .origin.lon
                  ),
                ]}
                icon={startIcon}
              >
                <Popup>
                  <b>
                    Current route
                    origin
                  </b>
                  <br />

                  {Number(
                    selected
                      .intelligence
                      ?.origin_for_route
                      ?.lat ??
                      selected
                        .origin.lat
                  ).toFixed(5)}
                  ,{" "}
                  {Number(
                    selected
                      .intelligence
                      ?.origin_for_route
                      ?.lon ??
                      selected
                        .origin.lon
                  ).toFixed(5)}
                </Popup>
              </Marker>

              <Marker
                position={[
                  Number(
                    selected
                      .destination.lat
                  ),
                  Number(
                    selected
                      .destination.lon
                  ),
                ]}
                icon={
                  destinationIcon
                }
              >
                <Popup>
                  <b>
                    Destination
                  </b>
                  <br />

                  {
                    selected
                      .destination.lat
                  }
                  ,{" "}
                  {
                    selected
                      .destination.lon
                  }
                </Popup>
              </Marker>
            </>
          )}
        </MapContainer>

        {/* ===================================================
            MAP LEGEND
           =================================================== */}

        <div className="map-legend">
          <span>
            <i className="legend-dot safe" />
            Safe
          </span>

          <span>
            <i className="legend-dot moderate" />
            Moderate
          </span>

          <span>
            <i className="legend-dot danger" />
            High/Critical
          </span>

          {selectedTraffic.available && (
            <>
              <span>
                <i className="traffic-line free" />
                Free
              </span>

              <span>
                <i className="traffic-line heavy" />
                Heavy traffic
              </span>

              <span>
                <i className="traffic-line severe" />
                Severe
              </span>
            </>
          )}

          <span>
            🚚 GPS vehicle
          </span>
        </div>

        {/* ===================================================
            SELECTED SHIPMENT OVERLAY
           =================================================== */}

        {selected && (
          <div className="map-overlay-card">
            <div className="overlay-title">
              <div>
                <b>
                  {selected.vehicle
                    ?.vehicle_number ||
                    "Unassigned"}
                </b>

                <small>
                  Shipment #
                  {selected.id.slice(
                    0,
                    8
                  )}
                </small>
              </div>

              <button
                onClick={() =>
                  setSelected(
                    null
                  )
                }
              >
                <X size={15} />
              </button>
            </div>

            <div className="overlay-grid">
              <div>
                <span>
                  Risk
                </span>

                <strong>
                  <RiskBadge
                    value={
                      selected
                        .intelligence
                        ?.risk_percent
                    }
                  />
                </strong>
              </div>

              <div>
                <span>
                  ETA
                </span>

                <strong>
                  {formatEta(
                    selected
                      .intelligence
                      ?.estimated_time_minutes
                  )}
                </strong>
              </div>

              <div>
                <span>
                  Access
                </span>

                <strong>
                  {selected
                    .intelligence
                    ?.road_accessibility_percent ??
                    "—"}
                  %
                </strong>
              </div>

              <div>
                <span>
                  ML
                </span>

                <strong>
                  {selected
                    .intelligence
                    ?.ml_prediction
                    ?.risk_level ||
                    "—"}
                </strong>
              </div>

              <div>
                <span>
                  Traffic
                </span>

                <strong>
                  {selectedTraffic.available
                    ? `${Math.round(
                        selectedTraffic.route_traffic_percent ||
                          0
                      )}%`
                    : "—"}
                </strong>
              </div>
            </div>

            {selectedTraffic.available &&
              selectedTraffic
                .traffic_ahead
                ?.length > 0 && (
                <div className="traffic-ahead">
                  <b>
                    ⚠ Traffic ahead
                  </b>

                  <span>
                    {
                      selectedTraffic
                        .traffic_ahead
                        .length
                    }{" "}
                    congested road
                    segment(s)
                    detected on
                    the selected
                    route.
                  </span>
                </div>
              )}

            {selected
              .intelligence
              ?.reroute_required && (
              <div className="reroute-alert">
                <Zap size={14} />

                REROUTE REQUIRED —
                safer route
                selected
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


/* =========================================================
   SHIPMENT TABLE
   ========================================================= */

function ShipmentTable({
  items,
  vehicles,
  selected,
  setSelected,
  onAssign,
  onCancel,
  onDeliver,
  title = "Shipments",
}) {
  const [filter, setFilter] =
    useState("ALL");

  const [search, setSearch] =
    useState("");

  const filtered = items.filter(
    (shipment) => {
      const status =
        normalizeStatus(
          shipment.status
        );

      const matchesFilter =
        filter === "ALL" ||
        (filter === "RISK" &&
          Number(
            shipment
              .intelligence
              ?.risk_percent || 0
          ) >= 60) ||
        status === filter ||
        normalizeStatus(
          shipment.category
        ) === filter;

      const q =
        search.toLowerCase();

      return (
        matchesFilter &&
        (
          !q ||
          shipment.id
            .toLowerCase()
            .includes(q) ||
          shipment.vehicle
            ?.vehicle_number
            ?.toLowerCase()
            .includes(q) ||
          String(
            shipment.category
          )
            .toLowerCase()
            .includes(q)
        )
      );
    }
  );

  return (
    <div className="panel shipment-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">
            <Package size={13} />
            OPERATIONS
          </span>

          <h2>{title}</h2>
        </div>

        <div className="table-tools">
          <div className="search-box">
            <Search size={14} />

            <input
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value
                )
              }
              placeholder="Search shipment / vehicle"
            />
          </div>
        </div>
      </div>

      <div className="filter-row">
        {[
          "ALL",
          "IN_TRANSIT",
          "PENDING",
          "RISK",
          "MEDICINE",
          "FOOD",
          "CONSTRUCTION",
        ].map((value) => (
          <button
            key={value}
            className={
              filter === value
                ? "active"
                : ""
            }
            onClick={() =>
              setFilter(value)
            }
          >
            {value.replace(
              "_",
              " "
            )}
          </button>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                Shipment
              </th>

              <th>
                Vehicle / GPS
              </th>

              <th>
                Priority
              </th>

              <th>
                Route
              </th>

              <th>
                ML + Traffic
              </th>

              <th>
                Status
              </th>

              <th>
                Actions
              </th>
            </tr>
          </thead>

          <tbody>
            {filtered.map(
              (shipment) => (
                <ShipmentRow
                  key={shipment.id}
                  s={shipment}
                  vehicles={vehicles}
                  selected={
                    selected?.id ===
                    shipment.id
                  }
                  onSelect={() => {
                    setSelected(
                      shipment
                    );

                    setTimeout(
                      () =>
                        window.__dalFocusShipment?.(
                          shipment
                        ),
                      0
                    );
                  }}
                  onAssign={
                    onAssign
                  }
                  onCancel={
                    onCancel
                  }
                  onDeliver={
                    onDeliver
                  }
                />
              )
            )}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="empty">
            No shipments match
            this filter.
          </div>
        )}
      </div>
    </div>
  );
}


/* =========================================================
   SHIPMENT ROW
   ========================================================= */

function ShipmentRow({
  s,
  vehicles,
  selected,
  onSelect,
  onAssign,
  onCancel,
  onDeliver,
}) {
  const [
    vehicleId,
    setVehicleId,
  ] = useState(
    s.vehicle?.id || ""
  );

  const status =
    normalizeStatus(s.status);

  /*
   * IMPORTANT FIX
   *
   * Show ALL vehicles in the manager
   * dropdown.
   *
   * Busy/in-transit vehicles remain
   * visible but are disabled.
   *
   * This lets the manager see the
   * complete fleet instead of the
   * dropdown appearing empty.
   */

  const availableVehicles =
    vehicles;

  useEffect(() => {
    setVehicleId(
      s.vehicle?.id || ""
    );
  }, [s.vehicle?.id]);

  return (
    <tr
      className={
        selected ? "selected" : ""
      }
      onClick={onSelect}
    >
      {/* =================================================
          SHIPMENT
         ================================================= */}

      <td>
        <b>
          #{s.id.slice(0, 8)}
        </b>

        <small>
          {s.category} ·{" "}
          {s.weight_kg} kg
        </small>
      </td>

      {/* =================================================
          VEHICLE / ASSIGNMENT
         ================================================= */}

      <td>
        {s.vehicle ? (
          <div className="vehicle-cell">
            <span className="truck-mini">
              🚚
            </span>

            <div>
              <b>
                {
                  s.vehicle
                    .vehicle_number
                }
              </b>

              <small>
                {s.vehicle.latitude !=
                null
                  ? `${Number(
                      s.vehicle
                        .latitude
                    ).toFixed(
                      5
                    )}, ${Number(
                      s.vehicle
                        .longitude
                    ).toFixed(
                      5
                    )}`
                  : "GPS unavailable"}{" "}
                ·{" "}
                {s.vehicle
                  .speed_kmh ??
                  0}{" "}
                km/h
              </small>
            </div>
          </div>
        ) : (
          <div className="assign-inline">
            <select
              value={vehicleId}
              onChange={(event) => {
                event.stopPropagation();

                setVehicleId(
                  event.target.value
                );
              }}
              onClick={(event) =>
                event.stopPropagation()
              }
            >
              <option value="">
                Assign vehicle
              </option>

              {availableVehicles.map(
                (vehicle) => {
                  const busy =
                    normalizeStatus(
                      vehicle.status
                    ) ===
                    "IN_TRANSIT";

                  return (
                    <option
                      key={vehicle.id}
                      value={
                        vehicle.id
                      }
                      disabled={
                        busy
                      }
                    >
                      {vehicle.vehicle_number}
                      {" — "}
                      {busy
                        ? "BUSY"
                        : "AVAILABLE"}
                    </option>
                  );
                }
              )}
            </select>

            <button
              onClick={(event) => {
                event.stopPropagation();

                if (
                  vehicleId
                ) {
                  onAssign(
                    s.id,
                    vehicleId
                  );
                }
              }}
            >
              Assign
            </button>
          </div>
        )}
      </td>

      {/* =================================================
          PRIORITY
         ================================================= */}

      <td>
        <span className="priority">
          {s.priority_level ||
            s.category}
        </span>
      </td>

      {/* =================================================
          ROUTE
         ================================================= */}

      <td>
        <div className="route-mini">
          <RouteIcon size={14} />

          <b>
            {s.intelligence
              ?.distance_km !=
            null
              ? `${Number(
                  s.intelligence
                    .distance_km
                ).toFixed(
                  1
                )} km`
              : "Route pending"}
          </b>

          <small>
            {s.intelligence
              ?.route_condition ||
              "—"}{" "}
            ·{" "}
            {formatEta(
              s.intelligence
                ?.estimated_time_minutes
            )}
          </small>
        </div>
      </td>

      {/* =================================================
          ML + TRAFFIC
         ================================================= */}

      <td>
        <div className="risk-traffic-cell">
          <RiskBadge
            value={
              s.intelligence
                ?.risk_percent
            }
          />

          <small>
            {s.intelligence
              ?.traffic?.available
              ? `Traffic ${Math.round(
                  s.intelligence
                    .traffic
                    .route_traffic_percent ||
                    0
                )}%`
              : "Traffic —"}
          </small>
        </div>
      </td>

      {/* =================================================
          STATUS
         ================================================= */}

      <td>
        <span
          className={`status-badge ${status.toLowerCase()}`}
        >
          {status.replace(
            "_",
            " "
          )}
        </span>
      </td>

      {/* =================================================
          ACTIONS
         ================================================= */}

      <td>
        <div className="row-actions">
          {status !==
            "DELIVERED" &&
            status !==
              "CANCELLED" && (
              <>
                <button
                  title="Deliver shipment"
                  onClick={(event) => {
                    event.stopPropagation();

                    onDeliver(
                      s.id
                    );
                  }}
                >
                  <CheckCircle2
                    size={14}
                  />
                </button>

                <button
                  className="cancel"
                  title="Cancel shipment"
                  onClick={(event) => {
                    event.stopPropagation();

                    onCancel(
                      s.id
                    );
                  }}
                >
                  <Ban size={14} />
                </button>
              </>
            )}
        </div>
      </td>
    </tr>
  );
}


/* =========================================================
   DETAIL PANEL
   ========================================================= */

function DetailPanel({
  shipment,
  events,
  onClose,
  onCancel,
  onDeliver,
}) {
  if (!shipment) {
    return (
      <div className="panel detail-empty">
        <LocateFixed size={22} />

        <b>
          Select a shipment
        </b>

        <span>
          Click a route, vehicle
          or shipment row to
          inspect live
          intelligence.
        </span>
      </div>
    );
  }

  const weather =
    shipment.intelligence
      ?.weather || {};

  const ml =
    shipment.intelligence
      ?.ml_prediction || {};

  const traffic =
    shipment.intelligence
      ?.traffic || {};

  const status =
    normalizeStatus(
      shipment.status
    );

  return (
    <div className="panel detail-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">
            <Zap size={13} />
            SMART DECISION
          </span>

          <h2>
            Shipment #
            {shipment.id.slice(
              0,
              8
            )}
          </h2>
        </div>

        <button
          className="icon-btn"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>

      <div className="decision">
        <div
          className={`decision-ring ${riskClass(
            shipment
              .intelligence
              ?.risk_percent
          )}`}
        >
          <strong>
            {shipment
              .intelligence
              ?.risk_percent ==
            null
              ? "—"
              : `${Math.round(
                  shipment
                    .intelligence
                    .risk_percent
                )}%`}
          </strong>

          <span>
            route risk
          </span>
        </div>

        <div>
          <h3>
            {shipment
              .intelligence
              ?.reroute_required
              ? "Rerouting recommended"
              : "Current route monitored"}
          </h3>

          <p>
            {shipment
              .intelligence
              ?.decision_reason ||
              "Route is being monitored continuously."}
          </p>
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <span>
            Vehicle
          </span>

          <b>
            {shipment.vehicle
              ?.vehicle_number ||
              "Unassigned"}
          </b>
        </div>

        <div>
          <span>
            GPS
          </span>

          <b>
            {shipment.vehicle
              ?.latitude !=
            null
              ? `${Number(
                  shipment
                    .vehicle
                    .latitude
                ).toFixed(
                  5
                )}, ${Number(
                  shipment
                    .vehicle
                    .longitude
                ).toFixed(
                  5
                )}`
              : "No fix"}
          </b>
        </div>

        <div>
          <span>
            Speed
          </span>

          <b>
            {shipment.vehicle
              ?.speed_kmh ??
              "—"}{" "}
            km/h
          </b>
        </div>

        <div>
          <span>
            Temperature
          </span>

          <b>
            {weather
              .temperature_c ??
              "—"}
            °C
          </b>
        </div>

        <div>
          <span>
            Rain
          </span>

          <b>
            {weather
              .rainfall_mm ??
              "—"}{" "}
            mm
          </b>
        </div>

        <div>
          <span>
            Wind
          </span>

          <b>
            {weather
              .wind_speed_kmh ??
              "—"}{" "}
            km/h
          </b>
        </div>

        <div>
          <span>
            Flood
          </span>

          <b>
            {weather
              .flood_risk_score !=
            null
              ? `${Math.round(
                  weather
                    .flood_risk_score *
                    100
                )}%`
              : "—"}
          </b>
        </div>

        <div>
          <span>
            Landslide
          </span>

          <b>
            {weather
              .landslide_risk_score !=
            null
              ? `${Math.round(
                  weather
                    .landslide_risk_score *
                    100
                )}%`
              : "—"}
          </b>
        </div>

        <div>
          <span>
            Accessibility
          </span>

          <b>
            {shipment
              .intelligence
              ?.road_accessibility_percent ??
              "—"}
            %
          </b>
        </div>

        <div>
          <span>
            ETA
          </span>

          <b>
            {formatEta(
              shipment
                .intelligence
                ?.estimated_time_minutes
            )}
          </b>
        </div>

        <div>
          <span>
            Road distance
          </span>

          <b>
            {shipment
              .intelligence
              ?.distance_km !=
            null
              ? `${Number(
                  shipment
                    .intelligence
                    .distance_km
                ).toFixed(
                  1
                )} km`
              : "—"}
          </b>
        </div>

        <div>
          <span>
            Routes found
          </span>

          <b>
            {shipment
              .intelligence
              ?.routes_found ??
              0}
          </b>
        </div>
      </div>

      <div className="decision-reason">
        <ShieldAlert size={16} />

        <div>
          <b>
            ML prediction:{" "}
            {ml.risk_level ||
              "—"}
          </b>

          <span>
            {ml.recommendation ||
              "Live environmental risk is being evaluated."}
          </span>
        </div>
      </div>

      <div className="traffic-panel">
        <div className="subheading">
          Traffic intelligence
        </div>

        {traffic.available ? (
          <>
            <div className="traffic-main">
              <b>
                {Math.round(
                  traffic
                    .route_traffic_percent ||
                    0
                )}
                %
              </b>

              <span>
                current route
                congestion
              </span>
            </div>

            {traffic
              .traffic_ahead
              ?.length > 0 ? (
              <div className="traffic-ahead-list">
                <b>
                  ⚠ Traffic
                  ahead
                </b>

                {traffic
                  .traffic_ahead
                  .slice(0, 5)
                  .map(
                    (
                      segment
                    ) => (
                      <div
                        key={
                          segment.index
                        }
                      >
                        <span>
                          Segment{" "}
                          {segment.index +
                            1}
                        </span>

                        <strong
                          className={`traffic-text ${segment.congestion}`}
                        >
                          {
                            segment.congestion
                          }
                        </strong>
                      </div>
                    )
                  )}
              </div>
            ) : (
              <div className="traffic-clear">
                ✓ No significant
                congestion
                detected ahead.
              </div>
            )}
          </>
        ) : (
          <div className="traffic-unavailable">
            Live traffic is not
            connected. Configure{" "}
            <b>
              MAPBOX_ACCESS_TOKEN
            </b>{" "}
            in the backend
            environment to enable
            traffic-aware routing.
          </div>
        )}
      </div>

      <div className="event-list">
        <div className="subheading">
          Event history
        </div>

        {events
          .slice(0, 6)
          .map((event) => (
            <div
              className="event"
              key={event.id}
            >
              <span>
                {formatTime(
                  event.created_at
                )}
              </span>

              <div>
                <b>
                  {
                    event.event_type
                  }
                </b>

                <small>
                  {event.message}
                </small>
              </div>
            </div>
          ))}

        {events.length === 0 && (
          <div className="event-empty">
            No events recorded
            yet.
          </div>
        )}
      </div>

      {status !==
        "DELIVERED" &&
        status !==
          "CANCELLED" && (
          <div className="detail-actions">
            <button
              className="danger-btn"
              onClick={() =>
                onCancel(
                  shipment.id
                )
              }
            >
              <Ban size={14} />
              Cancel shipment
            </button>

            <button
              className="success-btn"
              onClick={() =>
                onDeliver(
                  shipment.id
                )
              }
            >
              <CheckCircle2
                size={14}
              />
              Mark delivered
            </button>
          </div>
        )}
    </div>
  );
}


/* =========================================================
   LOCATION PICKER
   ========================================================= */

function LocationPicker({
  value,
  onChange,
}) {
  const [query, setQuery] =
    useState("");

  const [results, setResults] =
    useState([]);

  const [loading, setLoading] =
    useState(false);

  async function search() {
    if (!query.trim()) {
      return;
    }

    setLoading(true);

    try {
      const response =
        await axios.get(
          "https://nominatim.openstreetmap.org/search",
          {
            params: {
              q: `${query}, India`,
              format: "json",
              addressdetails: 1,
              limit: 8,
              countrycodes: "in",
              viewbox:
                "88,30,98,20",
              bounded: 1,
            },
          }
        );

      const filtered =
        response.data.filter(
          (item) =>
            STATES.some(
              (state) =>
                (
                  item.display_name ||
                  ""
                )
                  .toLowerCase()
                  .includes(
                    state.toLowerCase()
                  )
            )
        );

      setResults(
        filtered.length
          ? filtered
          : DEMO_LOCATIONS.filter(
              (location) =>
                location.name
                  .toLowerCase()
                  .includes(
                    query.toLowerCase()
                  )
            )
      );
    } catch {
      setResults(
        DEMO_LOCATIONS.filter(
          (location) =>
            location.name
              .toLowerCase()
              .includes(
                query.toLowerCase()
              )
        )
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="location-picker">
      <div className="search-box">
        <Search size={14} />

        <input
          value={query}
          onChange={(event) =>
            setQuery(
              event.target.value
            )
          }
          onKeyDown={(event) =>
            event.key === "Enter" &&
            search()
          }
          placeholder="Search NER city / destination"
        />

        <button
          onClick={search}
        >
          {loading
            ? "…"
            : "Search"}
        </button>
      </div>

      {results.length > 0 && (
        <div className="location-results">
          {results.map(
            (location, index) => (
              <button
                key={index}
                onClick={() => {
                  onChange({
                    name:
                      location.display_name ||
                      location.name,
                    lat: Number(
                      location.lat
                    ),
                    lon: Number(
                      location.lon
                    ),
                  });

                  setResults([]);

                  setQuery("");
                }}
              >
                <MapPin size={14} />

                {location.display_name ||
                  location.name}
              </button>
            )
          )}
        </div>
      )}

      {value && (
        <div className="selected-location">
          <MapPin size={14} />

          <span>
            {value.name}
          </span>

          <small>
            {Number(
              value.lat
            ).toFixed(4)}
            ,{" "}
            {Number(
              value.lon
            ).toFixed(4)}
          </small>
        </div>
      )}
    </div>
  );
}


/* =========================================================
   CREATE SHIPMENT MODAL
   ========================================================= */

function CreateShipmentModal({
  onClose,
  onCreated,
}) {
  const [form, setForm] =
    useState({
      pickup: WAREHOUSE,
      destination: null,
      weight: "",
      category: "medicine",
      urgency: "high",
    });

  const [saving, setSaving] =
    useState(false);

  const [err, setErr] =
    useState("");

  async function submit(event) {
    event.preventDefault();

    setErr("");

    if (!form.destination) {
      setErr(
        "Select a destination inside the North Eastern Region."
      );

      return;
    }

    if (!form.weight) {
      setErr(
        "Enter shipment weight."
      );

      return;
    }

    setSaving(true);

    try {
      const response =
        await api.post(
          "/shipments/create",
          {
            origin_lat:
              Number(
                form.pickup.lat
              ),

            origin_lon:
              Number(
                form.pickup.lon
              ),

            destination_lat:
              Number(
                form.destination.lat
              ),

            destination_lon:
              Number(
                form.destination.lon
              ),

            pickup_location:
              form.pickup.name,

            delivery_location:
              form.destination
                .name,

            weight_kg:
              Number(
                form.weight
              ),

            category:
              form.category,

            urgency_level:
              form.urgency,
          }
        );

      onCreated(
        response.data
      );

      onClose();
    } catch (error) {
      setErr(
        errorText(error)
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-head">
          <div>
            <span className="section-kicker">
              <Plus size={13} />
              NEW DISPATCH
            </span>

            <h2>
              Create shipment
            </h2>
          </div>

          <button
            className="icon-btn"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>

        <form
          onSubmit={submit}
        >
          <label>
            Pickup location

            <LocationPicker
              value={
                form.pickup
              }
              onChange={(value) =>
                setForm(
                  (current) => ({
                    ...current,
                    pickup:
                      value,
                  })
                )
              }
            />
          </label>

          <label>
            Destination

            <LocationPicker
              value={
                form.destination
              }
              onChange={(value) =>
                setForm(
                  (current) => ({
                    ...current,
                    destination:
                      value,
                  })
                )
              }
            />
          </label>

          <div className="form-grid">
            <label>
              Weight (kg)

              <input
                type="number"
                min="1"
                value={
                  form.weight
                }
                onChange={(event) =>
                  setForm(
                    (current) => ({
                      ...current,
                      weight:
                        event
                          .target
                          .value,
                    })
                  )
                }
              />
            </label>

            <label>
              Category

              <select
                value={
                  form.category
                }
                onChange={(event) =>
                  setForm(
                    (current) => ({
                      ...current,
                      category:
                        event
                          .target
                          .value,
                    })
                  )
                }
              >
                <option value="medicine">
                  Medicine
                </option>

                <option value="food">
                  Food
                </option>

                <option value="construction">
                  Construction
                </option>

                <option value="normal">
                  Normal
                </option>
              </select>
            </label>

            <label>
              Urgency

              <select
                value={
                  form.urgency
                }
                onChange={(event) =>
                  setForm(
                    (current) => ({
                      ...current,
                      urgency:
                        event
                          .target
                          .value,
                    })
                  )
                }
              >
                <option value="critical">
                  Critical
                </option>

                <option value="high">
                  High
                </option>

                <option value="medium">
                  Medium
                </option>

                <option value="low">
                  Low
                </option>
              </select>
            </label>
          </div>

          {err && (
            <div className="form-error">
              <AlertTriangle
                size={14}
              />

              {err}
            </div>
          )}

          <button
            className="primary-btn full"
            disabled={saving}
          >
            {saving
              ? "Creating…"
              : "Create & monitor shipment"}
          </button>
        </form>
      </div>
    </div>
  );
}


/* =========================================================
   DASHBOARD
   ========================================================= */

function Dashboard({
  data,
  selected,
  setSelected,
  vehicles,
  onAssign,
  onCancel,
  onDeliver,
  events,
  setFollow,
  follow,
  onRefresh,
}) {
  const all =
    data?.shipments || [];

  const items =
    data?.active_shipments ||
    all.filter(
      (shipment) =>
        ![
          "DELIVERED",
          "CANCELLED",
        ].includes(
          normalizeStatus(
            shipment.status
          )
        )
    );

  const summary =
    data?.summary || {};

  const risk = Number(
    summary.at_risk ??
      items.filter(
        (shipment) =>
          Number(
            shipment
              .intelligence
              ?.risk_percent ||
              0
          ) >= 60
      ).length
  );

  const active = Number(
    summary.active ??
      items.length
  );

  const delivered = Number(
    summary.delivered ??
      all.filter(
        (shipment) =>
          normalizeStatus(
            shipment.status
          ) === "DELIVERED"
      ).length
  );

  const cancelled = Number(
    summary.cancelled ??
      all.filter(
        (shipment) =>
          normalizeStatus(
            shipment.status
          ) === "CANCELLED"
      ).length
  );

  return (
    <>
      <div className="stats-grid">
        <StatCard
          icon={Package}
          label="Active shipments"
          value={active}
          sub="Live operations only"
        />

        <StatCard
          icon={Truck}
          label="Vehicles live"
          value={vehicles.length}
          sub={`${vehicles.filter(
            (vehicle) =>
              vehicle.latitude !=
              null
          ).length} with GPS`}
        />

        <StatCard
          icon={CheckCircle2}
          label="Delivered"
          value={delivered}
          sub="Completed shipments"
        />

        <StatCard
          icon={Ban}
          label="Cancelled"
          value={cancelled}
          sub="Closed shipments"
        />

        <StatCard
          icon={ShieldAlert}
          label="High risk"
          value={risk}
          sub="Requires attention"
          danger={risk > 0}
        />
      </div>

      <div className="main-grid">
        <SmartMap
          items={items}
          vehicles={vehicles}
          selected={selected}
          setSelected={
            setSelected
          }
          follow={follow}
          setFollow={
            setFollow
          }
        />

        <DetailPanel
          shipment={selected}
          events={events}
          onClose={() =>
            setSelected(null)
          }
          onCancel={onCancel}
          onDeliver={onDeliver}
        />
      </div>

      <div className="control-summary-strip">
        <span>
          <b>
            {items.length}
          </b>{" "}
          active on live map
        </span>

        <span>
          <b>
            {vehicles.length}
          </b>{" "}
          fleet vehicles
        </span>

        <span>
          <b>
            {delivered}
          </b>{" "}
          delivered
        </span>

        <span>
          <b>
            {cancelled}
          </b>{" "}
          cancelled
        </span>

        <span
          className={
            data?.traffic_provider ===
            "Mapbox Traffic"
              ? "live-text"
              : "warning-text"
          }
        >
          {data?.traffic_provider ===
          "Mapbox Traffic"
            ? "● LIVE TRAFFIC"
            : "● TRAFFIC API NOT CONFIGURED"}
        </span>
      </div>

      <ShipmentTable
        items={items}
        vehicles={vehicles}
        selected={selected}
        setSelected={
          setSelected
        }
        onAssign={onAssign}
        onCancel={onCancel}
        onDeliver={onDeliver}
        title="Active shipment operations"
      />
    </>
  );
}


/* =========================================================
   VEHICLES PAGE
   ========================================================= */

function VehiclesPage({
  vehicles,
  onRefresh,
}) {
  return (
    <div className="panel page-panel">
      <div className="panel-heading">
        <div>
          <span className="section-kicker">
            <Truck size={13} />
            FLEET
          </span>

          <h2>
            Live vehicle Available
          </h2>
        </div>

        <button
          className="secondary-btn"
          onClick={onRefresh}
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      <div className="vehicle-grid">
        {vehicles.map(
          (vehicle) => (
            <div
              className="vehicle-card"
              key={vehicle.id}
            >
              <div className="vehicle-card-top">
                <span className="truck-large">
                  🚚
                </span>

                <div>
                  <b>
                    {
                      vehicle.vehicle_number
                    }
                  </b>

                  <span
                    className={`status-badge ${normalizeStatus(
                      vehicle.status
                    ).toLowerCase()}`}
                  >
                    {normalizeStatus(
                      vehicle.status
                    ).replace(
                      "_",
                      " "
                    )}
                  </span>
                </div>
              </div>

              <div className="vehicle-metrics">
                <div>
                  <span>
                    GPS
                  </span>

                  <b>
                    {vehicle.latitude !=
                    null
                      ? `${Number(
                          vehicle.latitude
                        ).toFixed(
                          4
                        )}, ${Number(
                          vehicle.longitude
                        ).toFixed(
                          4
                        )}`
                      : "No fix"}
                  </b>
                </div>

                <div>
                  <span>
                    Speed
                  </span>

                  <b>
                    {vehicle
                      .speed_kmh ??
                      0}{" "}
                    km/h
                  </b>
                </div>

                <div>
                  <span>
                    Source
                  </span>

                  <b>
                    {vehicle.source ||
                      "database"}
                  </b>
                </div>

                <div>
                  <span>
                    Updated
                  </span>

                  <b>
                    {formatTime(
                      vehicle.last_updated
                    )}
                  </b>
                </div>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}


/* =========================================================
   SHIPMENTS PAGE
   ========================================================= */

function ShipmentsPage({
  data,
  vehicles,
  onAssign,
  onCancel,
  onDeliver,
  selected,
  setSelected,
}) {
  const [view, setView] =
    useState("ACTIVE");

  const all =
    data?.shipments || [];

  const groups = {
    ACTIVE: all.filter(
      (shipment) =>
        ![
          "DELIVERED",
          "CANCELLED",
        ].includes(
          normalizeStatus(
            shipment.status
          )
        )
    ),

    DELIVERED: all.filter(
      (shipment) =>
        normalizeStatus(
          shipment.status
        ) === "DELIVERED"
    ),

    CANCELLED: all.filter(
      (shipment) =>
        normalizeStatus(
          shipment.status
        ) === "CANCELLED"
    ),

    ALL: all,
  };

  return (
    <div className="shipments-page">
      <div className="page-title">
        <div>
          <span className="section-kicker">
            <Package size={13} />
            SHIPMENT MANAGEMENT
          </span>

          <h2>
            Shipment lifecycle
          </h2>

          <p>
            Active operations are
            separated from
            completed and cancelled
            records.
          </p>
        </div>
      </div>

      <div className="lifecycle-tabs">
        {Object.entries(
          groups
        ).map(
          ([key, list]) => (
            <button
              key={key}
              className={
                view === key
                  ? "active"
                  : ""
              }
              onClick={() =>
                setView(key)
              }
            >
              {key === "ACTIVE"
                ? "Active"
                : key ===
                  "DELIVERED"
                ? "Delivered"
                : key ===
                  "CANCELLED"
                ? "Cancelled"
                : "All records"}

              <b>
                {list.length}
              </b>
            </button>
          )
        )}
      </div>

      <ShipmentTable
        items={groups[view]}
        vehicles={vehicles}
        selected={selected}
        setSelected={
          setSelected
        }
        onAssign={onAssign}
        onCancel={onCancel}
        onDeliver={onDeliver}
        title={`${
          view === "ALL"
            ? "All records"
            : view[0] +
              view
                .slice(1)
                .toLowerCase()
        } shipments`}
      />
    </div>
  );
}


/* =========================================================
   ANALYTICS PAGE
   ========================================================= */

function AnalyticsPage({
  data,
  vehicles,
}) {
  const shipments =
    data.shipments || [];

  const counts = {
    medicine:
      shipments.filter(
        (shipment) =>
          shipment.category ===
          "medicine"
      ).length,

    food:
      shipments.filter(
        (shipment) =>
          shipment.category ===
          "food"
      ).length,

    construction:
      shipments.filter(
        (shipment) =>
          shipment.category ===
          "construction"
      ).length,
  };

  const averageRisk =
    shipments.length
      ? Math.round(
          shipments.reduce(
            (total, shipment) =>
              total +
              Number(
                shipment
                  .intelligence
                  ?.risk_percent ||
                  0
              ),
            0
          ) /
            shipments.length
        )
      : 0;

  return (
    <div className="analytics-grid">
      <div className="panel page-panel">
        <span className="section-kicker">
          <BarChart3 size={13} />
          INTELLIGENCE
        </span>

        <h2>
          Operational analytics
        </h2>

        <div className="big-metric">
          {averageRisk}%

          <small>
            average route risk
          </small>
        </div>

        <div className="bars">
          {Object.entries(
            counts
          ).map(
            ([category, value]) => (
              <div
                key={category}
              >
                <span>
                  {category}
                </span>

                <div>
                  <i
                    style={{
                      width: `${
                        shipments.length
                          ? Math.min(
                              100,
                              (value /
                                shipments.length) *
                                100
                            )
                          : 0
                      }%`,
                    }}
                  />
                </div>

                <b>
                  {value}
                </b>
              </div>
            )
          )}
        </div>
      </div>

      <div className="panel page-panel">
        <span className="section-kicker">
          <Radio size={13} />
          LIVE SYSTEM
        </span>

        <h2>
          Telemetry coverage
        </h2>

        <div className="coverage">
          <div>
            <Gauge size={20} />

            <b>
              {
                vehicles.filter(
                  (vehicle) =>
                    vehicle.latitude !=
                    null
                ).length
              }
              /
              {vehicles.length}
            </b>

            <span>
              vehicles with GPS
            </span>
          </div>

          <div>
            <CloudRain size={20} />

            <b>
              LIVE
            </b>

            <span>
              weather feed
            </span>
          </div>

          <div>
            <Zap size={20} />

            <b>
              {data.updated_at
                ? "ON"
                : "—"}
            </b>

            <span>
              ML intelligence
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}


/* =========================================================
   MAIN APPLICATION
   ========================================================= */

export default function App() {
  const [
    page,
    setPage,
  ] = useState("dashboard");

  const [
    data,
    setData,
  ] = useState({
    shipments: [],
    vehicles: [],
    updated_at: null,
  });

  const [
    selected,
    setSelected,
  ] = useState(null);

  const [
    events,
    setEvents,
  ] = useState([]);

  const [
    modal,
    setModal,
  ] = useState(false);

  const [
    refreshing,
    setRefreshing,
  ] = useState(false);

  const [
    follow,
    setFollow,
  ] = useState(false);

  const wsRef =
    useRef(null);


  /* =======================================================
     LOAD CONTROL ROOM
     ======================================================= */

const load =
  useCallback(
    async () => {
      setRefreshing(true);

      try {
        const [
          liveResponse,
          shipmentsResponse,
          driversResponse,
          vehiclesResponse,
        ] = await Promise.all([
          api.get(
            "/shipments/live-control-room"
          ),
          api.get(
            "/shipments/"
          ),
          api.get(
            "/drivers/"
          ),
          api.get(
            "/vehicles/"
          ),
        ]);

        const liveData =
          liveResponse.data || {};

        const shipments =
          Array.isArray(
            liveData.shipments
          )
            ? liveData.shipments
            : Array.isArray(
                shipmentsResponse.data
              )
            ? shipmentsResponse.data
            : [];

        const drivers =
          Array.isArray(
            driversResponse.data
          )
            ? driversResponse.data
            : [];

        const vehicles =
          Array.isArray(
            vehiclesResponse.data
          )
            ? vehiclesResponse.data
            : [];

        setData({
          ...liveData,
          shipments,
          drivers,
          vehicles,
        });

        setSelected(
          (previous) => {
            if (!previous) {
              return null;
            }

            const next =
              shipments.find(
                (shipment) =>
                  shipment.id ===
                  previous.id
              );

            if (
              !next ||
              [
                "DELIVERED",
                "CANCELLED",
              ].includes(
                normalizeStatus(
                  next.status
                )
              )
            ) {
              return null;
            }

            return next;
          }
        );

      } catch (error) {
        console.error(
          "Manager load failed:",
          errorText(error)
        );
      } finally {
        setRefreshing(false);
      }
    },
    []
  );

  /* =======================================================
     LOAD EVENTS
     ======================================================= */

  const loadEvents =
    useCallback(
      async (id) => {
        if (!id) {
          return;
        }

        try {
          const response =
            await api.get(
              `/shipments/${id}/events`
            );

          setEvents(
            response.data || []
          );
        } catch {
          setEvents([]);
        }
      },
      []
    );


  /* =======================================================
     INITIAL LOAD + POLLING
     ======================================================= */

  useEffect(() => {
    load();

    const timer =
      setInterval(
        load,
        20000
      );

    return () =>
      clearInterval(timer);
  }, [load]);


  /* =======================================================
     LOAD SELECTED SHIPMENT EVENTS
     ======================================================= */

  useEffect(() => {
    if (selected?.id) {
      loadEvents(
        selected.id
      );
    } else {
      setEvents([]);
    }
  }, [
    selected?.id,
    loadEvents,
  ]);


  /* =======================================================
     WEBSOCKET — FIXED
     ======================================================= */

  useEffect(() => {
    let socket;

    try {
      socket = new WebSocket(
        `${WS_BASE}/ws/control-room`
      );

      wsRef.current =
        socket;

      socket.onopen = () => {
        console.log(
          "DAL WebSocket connected"
        );
      };

      socket.onmessage = () => {
        load();
      };

      socket.onerror = (
        error
      ) => {
        console.warn(
          "DAL WebSocket error",
          error
        );
      };

      socket.onclose = () => {
        console.log(
          "DAL WebSocket disconnected"
        );
      };
    } catch (error) {
      console.warn(
        "WebSocket connection failed",
        error
      );
    }

    return () => {
      if (
        socket &&
        socket.readyState ===
          WebSocket.OPEN
      ) {
        socket.close();
      }

      wsRef.current = null;
    };
  }, [load]);


  /* =======================================================
     ASSIGN VEHICLE
     ======================================================= */

  async function assign(
    shipmentId,
    vehicleId
  ) {
    if (
      !shipmentId ||
      !vehicleId
    ) {
      return;
    }

    try {
      await api.post(
        `/shipments/${shipmentId}/assign-vehicle`,
        null,
        {
          params: {
            vehicle_id:
              vehicleId,
          },
        }
      );

      await load();
    } catch (error) {
      alert(
        errorText(error)
      );
    }
  }


  /* =======================================================
     CANCEL SHIPMENT
     ======================================================= */

  async function cancel(
    shipmentId
  ) {
    const reason =
      window.prompt(
        "Cancellation reason:",
        "Cancelled by manager"
      );

    if (reason === null) {
      return;
    }

    try {
      await api.post(
        `/shipments/${shipmentId}/cancel`,
        null,
        {
          params: {
            reason,
          },
        }
      );

      await load();
    } catch (error) {
      alert(
        errorText(error)
      );
    }
  }


  /* =======================================================
     DELIVER SHIPMENT
     ======================================================= */

  async function deliver(
    shipmentId
  ) {
    if (
      !window.confirm(
        "Mark this shipment as delivered?"
      )
    ) {
      return;
    }

    try {
      await api.post(
        `/shipments/${shipmentId}/deliver`
      );

      await load();
    } catch (error) {
      alert(
        errorText(error)
      );
    }
  }


  /* =======================================================
     PAGE CONTENT
     ======================================================= */

  const content =
    page === "dashboard" ? (
      <Dashboard
        data={data}
        selected={selected}
        setSelected={
          setSelected
        }
        vehicles={
          data.vehicles || []
        }
        onAssign={assign}
        onCancel={cancel}
        onDeliver={deliver}
        events={events}
        setFollow={setFollow}
        follow={follow}
        onRefresh={load}
      />
    ) : page ===
      "shipments" ? (
      <ShipmentsPage
        data={data}
        vehicles={
          data.vehicles || []
        }
        onAssign={assign}
        onCancel={cancel}
        onDeliver={deliver}
        selected={selected}
        setSelected={
          setSelected
        }
      />
    ) : page ===
      "vehicles" ? (
      <VehiclesPage
        vehicles={
          data.vehicles || []
        }
        onRefresh={load}
      />
    ) : (
      <AnalyticsPage
        data={data}
        vehicles={
          data.vehicles || []
        }
      />
    );


  /* =======================================================
     RENDER
     ======================================================= */

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        setPage={setPage}
      />

      <main className="main-content">
        <Header
          updatedAt={
            data.updated_at
          }
          onRefresh={load}
          refreshing={
            refreshing
          }
        />

        <div className="content">
          <div className="page-title">
            <div>
              <h2>
                {page ===
                "dashboard"
                  ? "Fleet control room"
                  : page
                      .charAt(0)
                      .toUpperCase() +
                    page.slice(
                      1
                    )}
              </h2>

              <p>
                {page ===
                "dashboard"
                  ? "See every active shipment, vehicle, route and disaster-risk decision in one live view."
                  : "Persistent operational data from the logistics database."}
              </p>
            </div>

            <button
              className="primary-btn"
              onClick={() =>
                setModal(true)
              }
            >
              <Plus size={16} />
              New shipment
            </button>
          </div>

          {content}
        </div>
      </main>

      {modal && (
        <CreateShipmentModal
          onClose={() =>
            setModal(false)
          }
          onCreated={load}
        />
      )}
    </div>
  );
}

