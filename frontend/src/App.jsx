import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, CloudRain, Crosshair,
  Gauge, LayoutDashboard, MapPin, Package, Plus, Radio, RefreshCw,
  Route as RouteIcon, Search, ShieldAlert, Truck, X, Navigation,
  Clock3, Ban, LocateFixed, Zap
} from "lucide-react";
import {
  MapContainer, Marker, Popup, Polyline, TileLayer, useMap
} from "react-leaflet";
import L from "leaflet";
import "./App.css";

const API_BASE = "http://localhost:8000/api/v1";
const api = axios.create({ baseURL: API_BASE, timeout: 20000 });
const NER_CENTER = [25.6, 91.9];
const NER_BOUNDS = [[21.7, 87.9], [29.6, 97.5]];
const STATES = ["Assam", "Arunachal Pradesh", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Sikkim", "Tripura"];
const WAREHOUSE = { name: "Guwahati Logistics Hub", lat: 26.1445, lon: 91.7362 };
const DEMO_LOCATIONS = [
  { name: "Guwahati, Assam", lat: 26.1445, lon: 91.7362 },
  { name: "Shillong, Meghalaya", lat: 25.5788, lon: 91.8933 },
  { name: "Imphal, Manipur", lat: 24.817, lon: 93.9368 },
  { name: "Kohima, Nagaland", lat: 25.6751, lon: 94.1086 },
  { name: "Aizawl, Mizoram", lat: 23.7271, lon: 92.7176 },
  { name: "Agartala, Tripura", lat: 23.8315, lon: 91.2868 },
  { name: "Itanagar, Arunachal Pradesh", lat: 27.0844, lon: 93.6053 },
  { name: "Gangtok, Sikkim", lat: 27.3389, lon: 88.6065 },
];

const icon = (emoji, cls = "map-icon") => L.divIcon({
  className: "",
  html: `<div class="${cls}">${emoji}</div>`,
  iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -18]
});
const truckIcon = icon("🚚", "map-icon vehicle-marker");
const destinationIcon = icon("📦", "map-icon destination-marker");
const warehouseIcon = icon("🏭", "map-icon warehouse-marker");
const startIcon = icon("●", "map-icon start-marker");

function normalizeStatus(v) { return String(v ?? "").toUpperCase(); }
function riskClass(risk = 0) {
  const n = Number(risk);
  if (n >= 75) return "critical";
  if (n >= 60) return "high";
  if (n >= 40) return "moderate";
  return "low";
}
function getRouteCoords(item) {
  const route = item?.intelligence?.selected_route || item?.intelligence?.route || {};
  let g = item?.intelligence?.route_geometry || route?.route_geometry || route?.geometry || route?.coordinates || [];
  if (!Array.isArray(g)) return [];
  return g.map(p => {
    if (Array.isArray(p) && p.length >= 2) return [Number(p[1]), Number(p[0])];
    if (p && p.lat != null && p.lon != null) return [Number(p.lat), Number(p.lon)];
    if (p && p.latitude != null && p.longitude != null) return [Number(p.latitude), Number(p.longitude)];
    return null;
  }).filter(p => p && Number.isFinite(p[0]) && Number.isFinite(p[1]));
}
function formatEta(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return "—";
  const m = Math.round(Number(minutes));
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}
function formatTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function errorText(error) {
  const d = error?.response?.data?.detail;
  if (Array.isArray(d)) return d.map(x => x?.msg || JSON.stringify(x)).join(", ");
  return d || error?.message || "Request failed";
}

function Header({ updatedAt, onRefresh, refreshing }) {
  return <header className="topbar">
    <div>
      <div className="eyebrow"><span className="live-dot" /> LIVE CONTROL ROOM</div>
      <h1>Disaster-Aware Logistics</h1>
      <p>North Eastern Region · Smart route intelligence</p>
    </div>
    <div className="topbar-actions">
      <div className="sync-pill"><Radio size={14} /> Live <span>{formatTime(updatedAt)}</span></div>
      <button className="icon-btn" onClick={onRefresh} disabled={refreshing} title="Refresh intelligence"><RefreshCw size={17} className={refreshing ? "spin" : ""} /></button>
    </div>
  </header>;
}

function Sidebar({ page, setPage }) {
  const items = [["dashboard", "Control Room", LayoutDashboard], ["shipments", "Shipments", Package], ["vehicles", "Vehicles", Truck], ["analytics", "Analytics", BarChart3]];
  return <aside className="sidebar">
    <div className="brand"><div className="brand-mark">DAL</div><div><strong>NEXORA</strong><small>Smart Logistics</small></div></div>
    <div className="sidebar-live"><span className="live-dot" /> SYSTEM LIVE</div>
    <nav>{items.map(([id, label, I]) => <button key={id} className={`nav-item ${page === id ? "active" : ""}`} onClick={() => setPage(id)}><I size={18}/><span>{label}</span></button>)}</nav>
    <div className="sidebar-footer"><ShieldAlert size={16}/><span>Disaster intelligence<br/><b>MONITORING ACTIVE</b></span></div>
  </aside>;
}

function StatCard({ icon: I, label, value, sub, danger }) {
  return <div className={`stat-card ${danger ? "stat-danger" : ""}`}><div className="stat-icon"><I size={18}/></div><div><div className="stat-label">{label}</div><div className="stat-value">{value}</div>{sub && <div className="stat-sub">{sub}</div>}</div></div>;
}

function RiskBadge({ value }) {
  const n = Math.round(Number(value || 0));
  const cls = riskClass(n);
  return <span className={`risk-badge ${cls}`}>{n}% {cls}</span>;
}

function MapController({ selected, items, vehicles, follow }) {
  const map = useMap();

  useEffect(() => {
    map.invalidateSize();
  }, [map]);

  useEffect(() => {
    if (!follow || !selected?.vehicle) return;
    const { latitude, longitude } = selected.vehicle;
    if (latitude != null && longitude != null) {
      map.setView(
        [Number(latitude), Number(longitude)],
        Math.max(map.getZoom(), 14),
        { animate: true }
      );
    }
  }, [selected, follow, map]);

  useEffect(() => {
    window.__dalFitMap = () => {
      const points = [];
      vehicles.forEach(v => {
        if (v.latitude != null && v.longitude != null) {
          points.push([Number(v.latitude), Number(v.longitude)]);
        }
      });
      items.forEach(s => {
        if (s.origin) points.push([Number(s.origin.lat), Number(s.origin.lon)]);
        if (s.destination) points.push([Number(s.destination.lat), Number(s.destination.lon)]);
        const coords = getRouteCoords(s);
        coords.forEach(p => points.push(p));
      });
      if (points.length > 1) map.fitBounds(points, { padding: [55, 55], maxZoom: 12, animate: true });
      else if (points.length === 1) map.setView(points[0], 14, { animate: true });
    };

    window.__dalFocusShipment = (shipment) => {
      const coords = [];
      if (shipment?.vehicle?.latitude != null) {
        coords.push([Number(shipment.vehicle.latitude), Number(shipment.vehicle.longitude)]);
      }
      const route = getRouteCoords(shipment);
      route.forEach(p => coords.push(p));
      if (coords.length > 1) map.fitBounds(coords, { padding: [60, 60], maxZoom: 15, animate: true });
      else if (coords.length === 1) map.setView(coords[0], 15, { animate: true });
    };
  }, [items, vehicles, map]);

  return null;
}

function trafficColor(level) {
  const v = String(level || "").toLowerCase();
  if (v === "severe") return "#b91c1c";
  if (v === "heavy") return "#ea580c";
  if (v === "moderate") return "#eab308";
  if (v === "free") return "#16a34a";
  return "#64748b";
}

function SmartMap({ items, vehicles, selected, setSelected, follow, setFollow }) {
  const selectedCoords = selected ? getRouteCoords(selected) : [];
  const selectedTraffic = selected?.intelligence?.traffic || {};
  const trafficSegments = selectedTraffic?.traffic_segments || [];
  const selectedRisk = riskClass(selected?.intelligence?.risk_percent);

  return <div className="map-shell">
    <div className="map-header">
      <div>
        <span className="section-kicker"><Activity size={13}/> LIVE GEOSPATIAL INTELLIGENCE</span>
        <h2>Fleet & Route Map</h2>
        <small className="map-subline">
          {vehicles.filter(v => v.latitude != null && v.longitude != null).length} GPS vehicles ·
          {items.length} active shipments ·
          {selectedTraffic.available ? " live traffic connected" : " traffic provider not configured"}
        </small>
      </div>
      <div className="map-actions">
        <button onClick={() => window.__dalFitMap?.()}><LocateFixed size={14}/> Fit fleet</button>
        {selected && <button onClick={() => window.__dalFocusShipment?.(selected)}><Navigation size={14}/> Focus route</button>}
        <button className={follow ? "active" : ""} onClick={() => setFollow(v => !v)}><Crosshair size={14}/> Follow vehicle</button>
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
          attribution='&copy; OpenStreetMap contributors'
          maxZoom={19}
        />
        <MapController selected={selected} items={items} vehicles={vehicles} follow={follow}/>

        <Marker position={[WAREHOUSE.lat, WAREHOUSE.lon]} icon={warehouseIcon}>
          <Popup><b>{WAREHOUSE.name}</b><br/>Central dispatch hub · Assam</Popup>
        </Marker>

        {/* Every fleet vehicle with GPS is visible, including unassigned vehicles. */}
        {vehicles.map(v => {
          if (v.latitude == null || v.longitude == null) return null;
          const assigned = items.find(s => s.vehicle?.id === v.id);
          const isSelected = selected?.vehicle?.id === v.id;
          return <Marker
            key={`vehicle-${v.id}`}
            position={[Number(v.latitude), Number(v.longitude)]}
            icon={truckIcon}
            zIndexOffset={isSelected ? 1000 : 500}
            eventHandlers={{ click: () => assigned && setSelected(assigned) }}
          >
            <Popup>
              <b>{v.vehicle_number}</b><br/>
              Status: {normalizeStatus(v.status).replace("_"," ")}<br/>
              GPS: {Number(v.latitude).toFixed(6)}, {Number(v.longitude).toFixed(6)}<br/>
              Speed: {v.speed_kmh ?? "—"} km/h<br/>
              Source: {v.source || "database"}<br/>
              Updated: {formatTime(v.last_updated)}
              {assigned && <><br/><b>Shipment: #{assigned.id.slice(0,8)}</b></>}
            </Popup>
          </Marker>;
        })}

        {/* All active shipment destinations. */}
        {items.map(s => <Marker
          key={`destination-${s.id}`}
          position={[Number(s.destination.lat), Number(s.destination.lon)]}
          icon={destinationIcon}
          eventHandlers={{ click: () => setSelected(s) }}
        >
          <Popup>
            <b>Shipment #{s.id.slice(0,8)}</b><br/>
            {String(s.category).toUpperCase()} · {normalizeStatus(s.status).replace("_"," ")}<br/>
            Risk: {s.intelligence?.risk_percent != null ? `${Math.round(s.intelligence.risk_percent)}%` : "—"}
          </Popup>
        </Marker>)}

        {/* Unselected active shipment routes stay visible so the control room sees the whole fleet. */}
        {items.filter(s => !selected || s.id !== selected.id).map(s => {
          const coords = getRouteCoords(s);
          if (coords.length < 2) return null;
          return <Polyline
            key={`route-${s.id}`}
            positions={coords}
            pathOptions={{
              color: riskClass(s.intelligence?.risk_percent) === "low" ? "#94a3b8" : "#f59e0b",
              weight: 3,
              opacity: 0.45,
              dashArray: "7 7"
            }}
          />;
        })}

        {/* Selected route: draw every traffic segment when live traffic is available. */}
        {selected && trafficSegments.length > 0 ? trafficSegments.slice(0, 350).map(seg =>
          <Polyline
            key={`traffic-${selected.id}-${seg.index}`}
            positions={[
              [Number(seg.from.lat), Number(seg.from.lon)],
              [Number(seg.to.lat), Number(seg.to.lon)]
            ]}
            pathOptions={{
              color: trafficColor(seg.congestion),
              weight: 7,
              opacity: 0.9
            }}
          />
        ) : selectedCoords.length > 1 ? <Polyline
          positions={selectedCoords}
          pathOptions={{
            color: selectedRisk === "low" ? "#159447" : selectedRisk === "moderate" ? "#d08a00" : "#d93636",
            weight: 7,
            opacity: 0.9
          }}
        /> : null}

        {/* Alternative road routes from the traffic router. */}
        {selected?.intelligence?.alternative_routes?.map(route => {
          const coords = getRouteCoords({ intelligence: { selected_route: route }});
          if (coords.length < 2) return null;
          return <Polyline
            key={`alternative-${selected.id}-${route.route_index}`}
            positions={coords}
            pathOptions={{ color: "#64748b", weight: 4, opacity: 0.5, dashArray: "12 9" }}
          />;
        })}

        {selected && <>
          <Marker
            position={[
              Number(selected.intelligence?.origin_for_route?.lat ?? selected.origin.lat),
              Number(selected.intelligence?.origin_for_route?.lon ?? selected.origin.lon)
            ]}
            icon={startIcon}
          >
            <Popup><b>Current route origin</b><br/>
              {Number(selected.intelligence?.origin_for_route?.lat ?? selected.origin.lat).toFixed(5)},
              {Number(selected.intelligence?.origin_for_route?.lon ?? selected.origin.lon).toFixed(5)}
            </Popup>
          </Marker>
          <Marker position={[Number(selected.destination.lat), Number(selected.destination.lon)]} icon={destinationIcon}>
            <Popup><b>Destination</b><br/>{selected.destination.lat}, {selected.destination.lon}</Popup>
          </Marker>
        </>}
      </MapContainer>

      <div className="map-legend">
        <span><i className="legend-dot safe"/>Safe</span>
        <span><i className="legend-dot moderate"/>Moderate</span>
        <span><i className="legend-dot danger"/>High/Critical</span>
        {selectedTraffic.available && <><span><i className="traffic-line free"/>Free</span><span><i className="traffic-line heavy"/>Heavy traffic</span><span><i className="traffic-line severe"/>Severe</span></>}
        <span>🚚 GPS vehicle</span>
      </div>

      {selected && <div className="map-overlay-card">
        <div className="overlay-title">
          <div>
            <b>{selected.vehicle?.vehicle_number || "Unassigned"}</b>
            <small>Shipment #{selected.id.slice(0,8)}</small>
          </div>
          <button onClick={() => setSelected(null)}><X size={15}/></button>
        </div>
        <div className="overlay-grid">
          <div><span>Risk</span><strong><RiskBadge value={selected.intelligence?.risk_percent}/></strong></div>
          <div><span>ETA</span><strong>{formatEta(selected.intelligence?.estimated_time_minutes)}</strong></div>
          <div><span>Access</span><strong>{selected.intelligence?.road_accessibility_percent ?? "—"}%</strong></div>
          <div><span>ML</span><strong>{selected.intelligence?.ml_prediction?.risk_level || "—"}</strong></div>
          <div><span>Traffic</span><strong>{selectedTraffic.available ? `${Math.round(selectedTraffic.route_traffic_percent || 0)}%` : "—"}</strong></div>
        </div>
        {selectedTraffic.available && selectedTraffic.traffic_ahead?.length > 0 && <div className="traffic-ahead">
          <b>⚠ Traffic ahead</b>
          <span>{selectedTraffic.traffic_ahead.length} congested road segment(s) detected on the selected route.</span>
        </div>}
        {selected.intelligence?.reroute_required && <div className="reroute-alert"><Zap size={14}/> REROUTE REQUIRED — safer route selected</div>}
      </div>}
    </div>
  </div>;
}

function ShipmentTable({ items, vehicles, selected, setSelected, onAssign, onCancel, onDeliver, title = "Shipments" }) {
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const filtered = items.filter(s => {
    const status = normalizeStatus(s.status);
    const matchesFilter =
      filter === "ALL" ||
      (filter === "RISK" && Number(s.intelligence?.risk_percent || 0) >= 60) ||
      status === filter ||
      normalizeStatus(s.category) === filter;
    const q = search.toLowerCase();
    return matchesFilter && (
      !q ||
      s.id.toLowerCase().includes(q) ||
      s.vehicle?.vehicle_number?.toLowerCase().includes(q) ||
      String(s.category).toLowerCase().includes(q)
    );
  });

  return <div className="panel shipment-panel">
    <div className="panel-heading">
      <div><span className="section-kicker"><Package size={13}/> OPERATIONS</span><h2>{title}</h2></div>
      <div className="table-tools">
        <div className="search-box"><Search size={14}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shipment / vehicle"/></div>
      </div>
    </div>
    <div className="filter-row">
      {["ALL","IN_TRANSIT","PENDING","RISK","MEDICINE","FOOD","CONSTRUCTION"].map(f =>
        <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>{f.replace("_"," ")}</button>
      )}
    </div>
    <div className="table-wrap">
      <table>
        <thead><tr><th>Shipment</th><th>Vehicle / GPS</th><th>Priority</th><th>Route</th><th>ML + Traffic</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {filtered.map(s =>
            <ShipmentRow
              key={s.id}
              s={s}
              vehicles={vehicles}
              selected={selected?.id === s.id}
              onSelect={() => {
                setSelected(s);
                setTimeout(() => window.__dalFocusShipment?.(s), 0);
              }}
              onAssign={onAssign}
              onCancel={onCancel}
              onDeliver={onDeliver}
            />
          )}
        </tbody>
      </table>
      {filtered.length === 0 && <div className="empty">No shipments match this filter.</div>}
    </div>
  </div>;
}

function ShipmentRow({ s, vehicles, selected, onSelect, onAssign, onCancel, onDeliver }) {
  const [vehicleId, setVehicleId] = useState(s.vehicle?.id || "");
  const status = normalizeStatus(s.status);
  const traffic = s.intelligence?.traffic || {};
  const availableVehicles = vehicles.filter(v =>
    normalizeStatus(v.status) !== "IN_TRANSIT" || v.id === s.vehicle?.id
  );

  return <tr className={selected ? "selected" : ""} onClick={onSelect}>
    <td><b>#{s.id.slice(0,8)}</b><small>{s.category} · {s.weight_kg} kg</small></td>
    <td>
      {s.vehicle ? <div className="vehicle-cell">
        <span className="truck-mini">🚚</span>
        <div>
          <b>{s.vehicle.vehicle_number}</b>
          <small>
            {s.vehicle.latitude != null
              ? `${Number(s.vehicle.latitude).toFixed(5)}, ${Number(s.vehicle.longitude).toFixed(5)}`
              : "GPS unavailable"} · {s.vehicle.speed_kmh ?? 0} km/h
          </small>
        </div>
      </div> : <div className="assign-inline">
        <select value={vehicleId} onChange={e => { e.stopPropagation(); setVehicleId(e.target.value); }} onClick={e => e.stopPropagation()}>
          <option value="">Assign vehicle</option>
          {availableVehicles.map(v => <option key={v.id} value={v.id}>{v.vehicle_number}</option>)}
        </select>
        <button onClick={e => { e.stopPropagation(); if (vehicleId) onAssign(s.id, vehicleId); }}>Assign</button>
      </div>}
    </td>
    <td><span className="priority">{s.priority_level || s.category}</span></td>
    <td><div className="route-mini"><RouteIcon size={14}/><b>{s.intelligence?.distance_km != null ? `${Number(s.intelligence.distance_km).toFixed(1)} km` : "Route pending"}</b><small>{s.intelligence?.route_condition || "—"} · {formatEta(s.intelligence?.estimated_time_minutes)}</small></div></td>
    <td>
      <div className="risk-traffic-cell"><RiskBadge value={s.intelligence?.risk_percent}/><small>{traffic.available ? `Traffic ${Math.round(traffic.route_traffic_percent || 0)}%` : "Traffic —"}</small></div>
    </td>
    <td><span className={`status-badge ${status.toLowerCase()}`}>{status.replace("_"," ")}</span></td>
    <td>
      <div className="row-actions">
        {status !== "DELIVERED" && status !== "CANCELLED" && <>
          <button title="Deliver shipment" onClick={e => { e.stopPropagation(); onDeliver(s.id); }}><CheckCircle2 size={14}/></button>
          <button className="cancel" title="Cancel shipment" onClick={e => { e.stopPropagation(); onCancel(s.id); }}><Ban size={14}/></button>
        </>}
      </div>
    </td>
  </tr>;
}

function DetailPanel({ shipment, events, onClose, onCancel, onDeliver }) {
  if (!shipment) return <div className="panel detail-empty"><LocateFixed size={22}/><b>Select a shipment</b><span>Click a route, vehicle or shipment row to inspect live intelligence.</span></div>;

  const w = shipment.intelligence?.weather || {};
  const ml = shipment.intelligence?.ml_prediction || {};
  const traffic = shipment.intelligence?.traffic || {};
  const status = normalizeStatus(shipment.status);

  return <div className="panel detail-panel">
    <div className="panel-heading">
      <div><span className="section-kicker"><Zap size={13}/> SMART DECISION</span><h2>Shipment #{shipment.id.slice(0,8)}</h2></div>
      <button className="icon-btn" onClick={onClose}><X size={16}/></button>
    </div>

    <div className="decision">
      <div className={`decision-ring ${riskClass(shipment.intelligence?.risk_percent)}`}>
        <strong>{shipment.intelligence?.risk_percent == null ? "—" : `${Math.round(shipment.intelligence.risk_percent)}%`}</strong>
        <span>route risk</span>
      </div>
      <div>
        <h3>{shipment.intelligence?.reroute_required ? "Rerouting recommended" : "Current route monitored"}</h3>
        <p>{shipment.intelligence?.decision_reason || "Route is being monitored continuously."}</p>
      </div>
    </div>

    <div className="detail-grid">
      <div><span>Vehicle</span><b>{shipment.vehicle?.vehicle_number || "Unassigned"}</b></div>
      <div><span>GPS</span><b>{shipment.vehicle?.latitude != null ? `${Number(shipment.vehicle.latitude).toFixed(5)}, ${Number(shipment.vehicle.longitude).toFixed(5)}` : "No fix"}</b></div>
      <div><span>Speed</span><b>{shipment.vehicle?.speed_kmh ?? "—"} km/h</b></div>
      <div><span>Temperature</span><b>{w.temperature_c ?? "—"}°C</b></div>
      <div><span>Rain</span><b>{w.rainfall_mm ?? "—"} mm</b></div>
      <div><span>Wind</span><b>{w.wind_speed_kmh ?? "—"} km/h</b></div>
      <div><span>Flood</span><b>{w.flood_risk_score != null ? `${Math.round(w.flood_risk_score*100)}%` : "—"}</b></div>
      <div><span>Landslide</span><b>{w.landslide_risk_score != null ? `${Math.round(w.landslide_risk_score*100)}%` : "—"}</b></div>
      <div><span>Accessibility</span><b>{shipment.intelligence?.road_accessibility_percent ?? "—"}%</b></div>
      <div><span>ETA</span><b>{formatEta(shipment.intelligence?.estimated_time_minutes)}</b></div>
      <div><span>Road distance</span><b>{shipment.intelligence?.distance_km != null ? `${Number(shipment.intelligence.distance_km).toFixed(1)} km` : "—"}</b></div>
      <div><span>Routes found</span><b>{shipment.intelligence?.routes_found ?? 0}</b></div>
    </div>

    <div className="decision-reason">
      <ShieldAlert size={16}/>
      <div><b>ML prediction: {ml.risk_level || "—"}</b><span>{ml.recommendation || "Live environmental risk is being evaluated."}</span></div>
    </div>

    <div className="traffic-panel">
      <div className="subheading">Traffic intelligence</div>
      {traffic.available
        ? <>
            <div className="traffic-main"><b>{Math.round(traffic.route_traffic_percent || 0)}%</b><span>current route congestion</span></div>
            {traffic.traffic_ahead?.length > 0
              ? <div className="traffic-ahead-list">
                  <b>⚠ Traffic ahead</b>
                  {traffic.traffic_ahead.slice(0,5).map(seg =>
                    <div key={seg.index}><span>Segment {seg.index + 1}</span><strong className={`traffic-text ${seg.congestion}`}>{seg.congestion}</strong></div>
                  )}
                </div>
              : <div className="traffic-clear">✓ No significant congestion detected ahead.</div>}
          </>
        : <div className="traffic-unavailable">Live traffic is not connected. Configure <b>MAPBOX_ACCESS_TOKEN</b> in the backend environment to enable traffic-aware routing.</div>}
    </div>

    <div className="event-list">
      <div className="subheading">Event history</div>
      {events.slice(0,6).map(e => <div className="event" key={e.id}><span>{formatTime(e.created_at)}</span><div><b>{e.event_type}</b><small>{e.message}</small></div></div>)}
      {events.length === 0 && <div className="event-empty">No events recorded yet.</div>}
    </div>

    {status !== "DELIVERED" && status !== "CANCELLED" && <div className="detail-actions">
      <button className="danger-btn" onClick={() => onCancel(shipment.id)}><Ban size={14}/> Cancel shipment</button>
      <button className="success-btn" onClick={() => onDeliver(shipment.id)}><CheckCircle2 size={14}/> Mark delivered</button>
    </div>}
  </div>;
}

function LocationPicker({ value, onChange }) {
  const [query, setQuery] = useState(""); const [results, setResults] = useState([]); const [loading, setLoading] = useState(false);
  async function search() {
    if (!query.trim()) return; setLoading(true);
    try { const r = await axios.get("https://nominatim.openstreetmap.org/search", { params: { q: `${query}, India`, format: "json", addressdetails: 1, limit: 8, countrycodes: "in", viewbox: "88,30,98,20", bounded: 1 } }); const filtered = r.data.filter(x => STATES.some(s => (x.display_name || "").toLowerCase().includes(s.toLowerCase()))); setResults(filtered.length ? filtered : DEMO_LOCATIONS.filter(x => x.name.toLowerCase().includes(query.toLowerCase()))); } catch { setResults(DEMO_LOCATIONS.filter(x => x.name.toLowerCase().includes(query.toLowerCase()))); } finally { setLoading(false); }
  }
  return <div className="location-picker"><div className="search-box"><Search size={14}/><input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === "Enter" && search()} placeholder="Search NER city / destination"/><button onClick={search}>{loading ? "…" : "Search"}</button></div>{results.length > 0 && <div className="location-results">{results.map((x, i) => <button key={i} onClick={() => {onChange({ name: x.display_name || x.name, lat: Number(x.lat), lon: Number(x.lon) }); setResults([]); setQuery("")}}><MapPin size={14}/>{x.display_name || x.name}</button>)}</div>}{value && <div className="selected-location"><MapPin size={14}/><span>{value.name}</span><small>{Number(value.lat).toFixed(4)}, {Number(value.lon).toFixed(4)}</small></div>}</div>;
}

function CreateShipmentModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ pickup: WAREHOUSE, destination: null, weight: "", category: "medicine", urgency: "high" }); const [saving, setSaving] = useState(false); const [err, setErr] = useState("");
  async function submit(e) { e.preventDefault(); setErr(""); if (!form.destination) return setErr("Select a destination inside the North Eastern Region."); if (!form.weight) return setErr("Enter shipment weight."); setSaving(true); try { const r = await api.post("/shipments/create", { origin_lat: Number(form.pickup.lat), origin_lon: Number(form.pickup.lon), destination_lat: Number(form.destination.lat), destination_lon: Number(form.destination.lon), pickup_location: form.pickup.name, delivery_location: form.destination.name, weight_kg: Number(form.weight), category: form.category, urgency_level: form.urgency }); onCreated(r.data); onClose(); } catch (e) { setErr(errorText(e)); } finally { setSaving(false); } }
  return <div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><span className="section-kicker"><Plus size={13}/> NEW DISPATCH</span><h2>Create shipment</h2></div><button className="icon-btn" onClick={onClose}><X size={16}/></button></div><form onSubmit={submit}><label>Pickup location<LocationPicker value={form.pickup} onChange={v => setForm(f => ({...f,pickup:v}))}/></label><label>Destination<LocationPicker value={form.destination} onChange={v => setForm(f => ({...f,destination:v}))}/></label><div className="form-grid"><label>Weight (kg)<input type="number" min="1" value={form.weight} onChange={e => setForm(f => ({...f,weight:e.target.value}))}/></label><label>Category<select value={form.category} onChange={e => setForm(f => ({...f,category:e.target.value}))}><option value="medicine">Medicine</option><option value="food">Food</option><option value="construction">Construction</option><option value="normal">Normal</option></select></label><label>Urgency<select value={form.urgency} onChange={e => setForm(f => ({...f,urgency:e.target.value}))}><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label></div>{err && <div className="form-error"><AlertTriangle size={14}/>{err}</div>}<button className="primary-btn full" disabled={saving}>{saving ? "Creating…" : "Create & monitor shipment"}</button></form></div></div>;
}

function Dashboard({ data, selected, setSelected, vehicles, onAssign, onCancel, onDeliver, events, setFollow, follow, onRefresh }) {
  const all = data?.shipments || [];
  const items = data?.active_shipments || all.filter(s => !["DELIVERED","CANCELLED"].includes(normalizeStatus(s.status)));
  const summary = data?.summary || {};
  const risk = Number(summary.at_risk ?? items.filter(s => Number(s.intelligence?.risk_percent || 0) >= 60).length);
  const active = Number(summary.active ?? items.length);
  const delivered = Number(summary.delivered ?? all.filter(s => normalizeStatus(s.status) === "DELIVERED").length);
  const cancelled = Number(summary.cancelled ?? all.filter(s => normalizeStatus(s.status) === "CANCELLED").length);

  return <>
    <div className="stats-grid">
      <StatCard icon={Package} label="Active shipments" value={active} sub="Live operations only"/>
      <StatCard icon={Truck} label="Vehicles live" value={vehicles.length} sub={`${vehicles.filter(v => v.latitude != null).length} with GPS`}/>
      <StatCard icon={CheckCircle2} label="Delivered" value={delivered} sub="Completed shipments"/>
      <StatCard icon={Ban} label="Cancelled" value={cancelled} sub="Closed shipments"/>
      <StatCard icon={ShieldAlert} label="High risk" value={risk} sub="Requires attention" danger={risk > 0}/>
    </div>

    <div className="main-grid">
      <SmartMap
        items={items}
        vehicles={vehicles}
        selected={selected}
        setSelected={setSelected}
        follow={follow}
        setFollow={setFollow}
      />
      <DetailPanel
        shipment={selected}
        events={events}
        onClose={() => setSelected(null)}
        onCancel={onCancel}
        onDeliver={onDeliver}
      />
    </div>

    <div className="control-summary-strip">
      <span><b>{items.length}</b> active on live map</span>
      <span><b>{vehicles.length}</b> fleet vehicles</span>
      <span><b>{delivered}</b> delivered</span>
      <span><b>{cancelled}</b> cancelled</span>
      <span className={data?.traffic_provider === "Mapbox Traffic" ? "live-text" : "warning-text"}>
        {data?.traffic_provider === "Mapbox Traffic" ? "● LIVE TRAFFIC" : "● TRAFFIC API NOT CONFIGURED"}
      </span>
    </div>

    <ShipmentTable
      items={items}
      vehicles={vehicles}
      selected={selected}
      setSelected={setSelected}
      onAssign={onAssign}
      onCancel={onCancel}
      onDeliver={onDeliver}
      title="Active shipment operations"
    />
  </>;
}

function VehiclesPage({ vehicles, onRefresh }) { return <div className="panel page-panel"><div className="panel-heading"><div><span className="section-kicker"><Truck size={13}/> FLEET</span><h2>Live vehicle telemetry</h2></div><button className="secondary-btn" onClick={onRefresh}><RefreshCw size={14}/> Refresh</button></div><div className="vehicle-grid">{vehicles.map(v => <div className="vehicle-card" key={v.id}><div className="vehicle-card-top"><span className="truck-large">🚚</span><div><b>{v.vehicle_number}</b><span className={`status-badge ${normalizeStatus(v.status).toLowerCase()}`}>{normalizeStatus(v.status).replace("_", " ")}</span></div></div><div className="vehicle-metrics"><div><span>GPS</span><b>{v.latitude != null ? `${Number(v.latitude).toFixed(4)}, ${Number(v.longitude).toFixed(4)}` : "No fix"}</b></div><div><span>Speed</span><b>{v.speed_kmh ?? 0} km/h</b></div><div><span>Source</span><b>{v.source || "database"}</b></div><div><span>Updated</span><b>{formatTime(v.last_updated)}</b></div></div></div>)}</div></div>; }
function ShipmentsPage({ data, vehicles, onAssign, onCancel, onDeliver, selected, setSelected }) {
  const [view, setView] = useState("ACTIVE");
  const all = data?.shipments || [];
  const groups = {
    ACTIVE: all.filter(s => !["DELIVERED","CANCELLED"].includes(normalizeStatus(s.status))),
    DELIVERED: all.filter(s => normalizeStatus(s.status) === "DELIVERED"),
    CANCELLED: all.filter(s => normalizeStatus(s.status) === "CANCELLED"),
    ALL: all,
  };
  return <div className="shipments-page">
    <div className="page-title">
      <div><span className="section-kicker"><Package size={13}/> SHIPMENT MANAGEMENT</span><h2>Shipment lifecycle</h2><p>Active operations are separated from completed and cancelled records.</p></div>
    </div>
    <div className="lifecycle-tabs">
      {Object.entries(groups).map(([key, list]) =>
        <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}>
          {key === "ACTIVE" ? "Active" : key === "DELIVERED" ? "Delivered" : key === "CANCELLED" ? "Cancelled" : "All records"}
          <b>{list.length}</b>
        </button>
      )}
    </div>
    <ShipmentTable
      items={groups[view]}
      vehicles={vehicles}
      selected={selected}
      setSelected={setSelected}
      onAssign={onAssign}
      onCancel={onCancel}
      onDeliver={onDeliver}
      title={`${view === "ALL" ? "All records" : view[0] + view.slice(1).toLowerCase()} shipments`}
    />
  </div>;
}

function AnalyticsPage({ data, vehicles }) { const s = data.shipments || []; const counts = {medicine:s.filter(x=>x.category==="medicine").length,food:s.filter(x=>x.category==="food").length,construction:s.filter(x=>x.category==="construction").length}; const avg = s.length ? Math.round(s.reduce((a,x)=>a+Number(x.intelligence?.risk_percent||0),0)/s.length) : 0; return <div className="analytics-grid"><div className="panel page-panel"><span className="section-kicker"><BarChart3 size={13}/> INTELLIGENCE</span><h2>Operational analytics</h2><div className="big-metric">{avg}%<small>average route risk</small></div><div className="bars">{Object.entries(counts).map(([k,v]) => <div key={k}><span>{k}</span><div><i style={{width:`${s.length ? Math.min(100,v/s.length*100):0}%`}}/></div><b>{v}</b></div>)}</div></div><div className="panel page-panel"><span className="section-kicker"><Radio size={13}/> LIVE SYSTEM</span><h2>Telemetry coverage</h2><div className="coverage"><div><Gauge size={20}/><b>{vehicles.filter(v=>v.latitude!=null).length}/{vehicles.length}</b><span>vehicles with GPS</span></div><div><CloudRain size={20}/><b>LIVE</b><span>weather feed</span></div><div><Zap size={20}/><b>{data.updated_at ? "ON" : "—"}</b><span>ML intelligence</span></div></div></div></div>; }

export default function App() {
  const [page, setPage] = useState("dashboard"); const [data, setData] = useState({ shipments: [], vehicles: [], updated_at: null }); const [selected, setSelected] = useState(null); const [events, setEvents] = useState([]); const [modal, setModal] = useState(false); const [refreshing, setRefreshing] = useState(false); const [follow, setFollow] = useState(false); const wsRef = useRef(null);
  const load = useCallback(async () => { setRefreshing(true); try { const r = await api.get("/shipments/live-control-room"); setData(r.data);
      setSelected(prev => {
        if (!prev) return null;
        const next = (r.data.shipments || []).find(x => x.id === prev.id);
        if (!next || ["DELIVERED","CANCELLED"].includes(normalizeStatus(next.status))) return null;
        return next;
      }); } catch (e) { console.error(errorText(e)); } finally { setRefreshing(false); } }, []);
  const loadEvents = useCallback(async id => { if (!id) return; try { const r = await api.get(`/shipments/${id}/events`); setEvents(r.data || []); } catch { setEvents([]); } }, []);
  useEffect(() => { load(); const timer = setInterval(load, 20000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (selected?.id) loadEvents(selected.id); }, [selected?.id, loadEvents]);
  useEffect(() => { try { const ws = new WebSocket("ws://localhost:8000/ws/control-room"); wsRef.current = ws; ws.onmessage = () => load(); ws.onclose = () => {}; return () => ws.close(); } catch {} }, [load]);
  async function assign(id, vehicle_id) { try { await api.post(`/shipments/${id}/assign-vehicle`, null, { params: { vehicle_id } }); await load(); } catch(e) { alert(errorText(e)); } }
  async function cancel(id) { const reason = window.prompt("Cancellation reason:", "Cancelled by manager"); if (reason === null) return; try { await api.post(`/shipments/${id}/cancel`, null, { params: { reason } }); await load(); } catch(e) { alert(errorText(e)); } }
  async function deliver(id) { if (!window.confirm("Mark this shipment as delivered?")) return; try { await api.post(`/shipments/${id}/deliver`); await load(); } catch(e) { alert(errorText(e)); } }
  const content = page === "dashboard" ? <Dashboard data={data} selected={selected} setSelected={setSelected} vehicles={data.vehicles || []} onAssign={assign} onCancel={cancel} onDeliver={deliver} events={events} setFollow={setFollow} follow={follow} onRefresh={load}/> : page === "shipments" ? <ShipmentsPage data={data} vehicles={data.vehicles || []} onAssign={assign} onCancel={cancel} onDeliver={deliver} selected={selected} setSelected={setSelected}/> : page === "vehicles" ? <VehiclesPage vehicles={data.vehicles || []} onRefresh={load}/> : <AnalyticsPage data={data} vehicles={data.vehicles || []}/>;
  return <div className="app-shell"><Sidebar page={page} setPage={setPage}/><main className="main-content"><Header updatedAt={data.updated_at} onRefresh={load} refreshing={refreshing}/><div className="content"><div className="page-title"><div><h2>{page === "dashboard" ? "Fleet control room" : page[0].toUpperCase()+page.slice(1)}</h2><p>{page === "dashboard" ? "See every active shipment, vehicle, route and disaster-risk decision in one live view." : "Persistent operational data from the logistics database."}</p></div><button className="primary-btn" onClick={() => setModal(true)}><Plus size={16}/> New shipment</button></div>{content}</div></main>{modal && <CreateShipmentModal onClose={() => setModal(false)} onCreated={load}/>}</div>;
}
