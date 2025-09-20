// Delhi Bus Tracker JavaScript

// Configuration
const API_KEY = '2yLghINly0UJaU6iswVB8MvqGUVTbRPW';
const PROXY_SERVICES = [
    'https://api.allorigins.win/raw?url=',
    'https://thingproxy.freeboard.io/fetch/',
    'https://corsproxy.io/?'
];
const BASE_URL = 'https://otd.delhi.gov.in';
let CURRENT_PROXY = PROXY_SERVICES[0];

// Map and data storage
let map;
let busMarkers = [];
let stopMarkers = [];
let routeLines = [];
let layerGroups = {
    buses: L.layerGroup(),
    stops: L.layerGroup(),
    routes: L.layerGroup()
};
let layerVisibility = {
    buses: true,
    stops: true,
    routes: true
};

// Data storage for API-fetched data
let delhiBusStops = [];
let delhinBusRoutes = [];

// Auto-refresh interval
let autoRefreshInterval;

// Initialize map
function initMap() {
    map = L.map('map').setView([28.6139, 77.2090], 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Add layer groups to map
    Object.values(layerGroups).forEach(group => group.addTo(map));
    
    updateStatus('Map initialized', 'connected');
}

// API URL builders
function buildStopsApiUrl() {
    const originalUrl = `${BASE_URL}/api/gtfs/stops.txt?key=${API_KEY}`;
    if (CURRENT_PROXY.endsWith('raw?url=') || CURRENT_PROXY.endsWith('?')) {
        return `${CURRENT_PROXY}${encodeURIComponent(originalUrl)}`;
    }
    return `${CURRENT_PROXY}${originalUrl}`;
}

function buildRoutesApiUrl() {
    const originalUrl = `${BASE_URL}/api/gtfs/routes.txt?key=${API_KEY}`;
    if (CURRENT_PROXY.endsWith('raw?url=') || CURRENT_PROXY.endsWith('?')) {
        return `${CURRENT_PROXY}${encodeURIComponent(originalUrl)}`;
    }
    return `${CURRENT_PROXY}${originalUrl}`;
}

function buildShapesApiUrl() {
    const originalUrl = `${BASE_URL}/api/gtfs/shapes.txt?key=${API_KEY}`;
    if (CURRENT_PROXY.endsWith('raw?url=') || CURRENT_PROXY.endsWith('?')) {
        return `${CURRENT_PROXY}${encodeURIComponent(originalUrl)}`;
    }
    return `${CURRENT_PROXY}${originalUrl}`;
}

function buildVehicleApiUrl() {
    const originalUrl = `${BASE_URL}/api/realtime/VehiclePositions.pb?key=${API_KEY}`;
    if (CURRENT_PROXY.endsWith('raw?url=') || CURRENT_PROXY.endsWith('?')) {
        return `${CURRENT_PROXY}${encodeURIComponent(originalUrl)}`;
    }
    return `${CURRENT_PROXY}${originalUrl}`;
}

// Update status
function updateStatus(message, type) {
    const statusEl = document.getElementById('status');
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
}

// Create bus marker
function createBusMarker(lat, lng, vehicleData) {
    const busIcon = L.divIcon({
        className: 'bus-marker',
        html: '🚌',
        iconSize: [25, 25],
        iconAnchor: [12, 12]
    });
    
    const marker = L.marker([lat, lng], { icon: busIcon });
    marker.bindPopup(createBusPopupContent(vehicleData));
    layerGroups.buses.addLayer(marker);
    return marker;
}

// Create bus popup content
function createBusPopupContent(vehicleData) {
    const routeId = vehicleData.trip?.routeId || 'Unknown';
    const vehicleId = vehicleData.vehicle?.id || 'Unknown';
    const speed = vehicleData.position?.speed 
        ? `${Math.round(vehicleData.position.speed * 3.6)} km/h` 
        : 'Unknown';
    const timestamp = vehicleData.timestamp 
        ? new Date(vehicleData.timestamp * 1000).toLocaleTimeString() 
        : 'Unknown';
    
    return `
        <div style="font-family: Arial, sans-serif;">
            <h4 style="margin: 0 0 10px 0; color: #2c3e50;">🚌 Bus Information</h4>
            <p><strong>Route:</strong> ${routeId}</p>
            <p><strong>Vehicle ID:</strong> ${vehicleId}</p>
            <p><strong>Speed:</strong> ${speed}</p>
            <p><strong>Last Update:</strong> ${timestamp}</p>
        </div>
    `;
}

// Create stop marker
function createStopMarker(stop) {
    const stopIcon = L.divIcon({
        className: 'stop-marker',
        html: '',
        iconSize: [12, 12],
        iconAnchor: [6, 6]
    });
    
    const marker = L.marker([stop.lat, stop.lng], { icon: stopIcon });
    marker.bindPopup(`
        <div style="font-family: Arial, sans-serif;">
            <h4 style="margin: 0 0 10px 0; color: #e74c3c;">🚏 ${stop.name}</h4>
            <p><strong>Stop ID:</strong> ${stop.id}</p>
            <p><strong>Location:</strong> ${stop.lat.toFixed(4)}, ${stop.lng.toFixed(4)}</p>
        </div>
    `);
    layerGroups.stops.addLayer(marker);
    return marker;
}

// Create route line
function createRouteLine(route) {
    const polyline = L.polyline(route.coordinates, {
        color: '#3498db',
        weight: 3,
        opacity: 0.7
    });
    
    polyline.bindPopup(`
        <div style="font-family: Arial, sans-serif;">
            <h4 style="margin: 0 0 10px 0; color: #3498db;">🛣️ ${route.name}</h4>
            <p><strong>Route ID:</strong> ${route.id}</p>
            <p><strong>Stops:</strong> ${route.coordinates.length}</p>
        </div>
    `);
    layerGroups.routes.addLayer(polyline);
    return polyline;
}

// Clear markers
function clearLayer(layerType) {
    layerGroups[layerType].clearLayers();
    if (layerType === 'buses') busMarkers = [];
    if (layerType === 'stops') stopMarkers = [];
    if (layerType === 'routes') routeLines = [];
}

// Toggle layer visibility
function toggleLayer(layerType) {
    layerVisibility[layerType] = !layerVisibility[layerType];
    const button = document.getElementById(`${layerType}Toggle`);
    
    if (layerVisibility[layerType]) {
        map.addLayer(layerGroups[layerType]);
        button.classList.add('active');
    } else {
        map.removeLayer(layerGroups[layerType]);
        button.classList.remove('active');
    }
}

// Parse CSV data
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = [];
        let current = '';
        let inQuotes = false;
        
        for (let j = 0; j < lines[i].length; j++) {
            const char = lines[i][j];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                values.push(current.trim().replace(/"/g, ''));
                current = '';
            } else {
                current += char;
            }
        }
        values.push(current.trim().replace(/"/g, ''));
        
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] || '';
        });
        data.push(row);
    }
    return data;
}

// Fetch bus stops from API
async function fetchBusStops() {
    for (let i = 0; i < PROXY_SERVICES.length; i++) {
        CURRENT_PROXY = PROXY_SERVICES[i];
        const url = buildStopsApiUrl();

        try {
            console.log(`Fetching stops with proxy ${i + 1}: ${CURRENT_PROXY}`);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const csvText = await response.text();
            const stopsData = parseCSV(csvText);
            
            // Convert GTFS format to our format
            delhiBusStops = stopsData.map(stop => ({
                id: stop.stop_id,
                name: stop.stop_name,
                lat: parseFloat(stop.stop_lat),
                lng: parseFloat(stop.stop_lon),
                code: stop.stop_code || stop.stop_id
            })).filter(stop => !isNaN(stop.lat) && !isNaN(stop.lng));

            console.log(`Loaded ${delhiBusStops.length} bus stops`);
            return true;
        } catch (error) {
            console.error(`Stops fetch with proxy ${i + 1} failed:`, error);
            if (i === PROXY_SERVICES.length - 1) {
                throw error;
            }
        }
    }
}

// Fetch bus routes from API
async function fetchBusRoutes() {
    for (let i = 0; i < PROXY_SERVICES.length; i++) {
        CURRENT_PROXY = PROXY_SERVICES[i];
        const url = buildRoutesApiUrl();

        try {
            console.log(`Fetching routes with proxy ${i + 1}: ${CURRENT_PROXY}`);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const csvText = await response.text();
            const routesData = parseCSV(csvText);
            
            // Convert GTFS format to our format
            delhinBusRoutes = routesData.map(route => ({
                id: route.route_id,
                name: route.route_short_name + ' - ' + route.route_long_name,
                shortName: route.route_short_name,
                longName: route.route_long_name,
                type: route.route_type,
                color: route.route_color || '3498db'
            }));

            console.log(`Loaded ${delhinBusRoutes.length} bus routes`);
            return true;
        } catch (error) {
            console.error(`Routes fetch with proxy ${i + 1} failed:`, error);
            if (i === PROXY_SERVICES.length - 1) {
                throw error;
            }
        }
    }
}

// Fetch route shapes (for drawing routes on map)
async function fetchRouteShapes() {
    for (let i = 0; i < PROXY_SERVICES.length; i++) {
        CURRENT_PROXY = PROXY_SERVICES[i];
        const url = buildShapesApiUrl();

        try {
            console.log(`Fetching shapes with proxy ${i + 1}: ${CURRENT_PROXY}`);
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const csvText = await response.text();
            const shapesData = parseCSV(csvText);
            
            // Group shapes by shape_id
            const shapeGroups = {};
            shapesData.forEach(shape => {
                if (!shapeGroups[shape.shape_id]) {
                    shapeGroups[shape.shape_id] = [];
                }
                shapeGroups[shape.shape_id].push({
                    lat: parseFloat(shape.shape_pt_lat),
                    lng: parseFloat(shape.shape_pt_lon),
                    sequence: parseInt(shape.shape_pt_sequence)
                });
            });

            // Convert to route coordinates
            Object.keys(shapeGroups).forEach(shapeId => {
                const coordinates = shapeGroups[shapeId]
                    .sort((a, b) => a.sequence - b.sequence)
                    .map(point => [point.lat, point.lng])
                    .filter(coord => !isNaN(coord[0]) && !isNaN(coord[1]));
                
                if (coordinates.length > 0) {
                    delhinBusRoutes.forEach(route => {
                        if (!route.coordinates) {
                            route.coordinates = coordinates;
                            route.shapeId = shapeId;
                        }
                    });
                }
            });

            console.log(`Processed shapes for ${Object.keys(shapeGroups).length} routes`);
            return true;
        } catch (error) {
            console.error(`Shapes fetch with proxy ${i + 1} failed:`, error);
            // Shapes are optional, so we don't fail if they're not available
            return false;
        }
    }
}

// Load bus stops
function loadBusStops() {
    clearLayer('stops');
    if (delhiBusStops.length === 0) {
        console.log('No bus stops data available');
        return;
    }
    
    delhiBusStops.forEach(stop => {
        const marker = createStopMarker(stop);
        stopMarkers.push(marker);
    });
}

// Load routes
function loadRoutes() {
    clearLayer('routes');
    if (delhinBusRoutes.length === 0) {
        console.log('No routes data available');
        return;
    }
    
    delhinBusRoutes.forEach(route => {
        if (route.coordinates && route.coordinates.length > 1) {
            const line = createRouteLine(route);
            routeLines.push(line);
        }
    });
}

// Process vehicle positions
function processVehiclePositions(feedMessage) {
    clearLayer('buses');
    if (!feedMessage.entity) return;

    feedMessage.entity.forEach(entity => {
        const vehicle = entity.vehicle;
        if (vehicle && vehicle.position) {
            const { latitude, longitude } = vehicle.position;
            const marker = createBusMarker(latitude, longitude, vehicle);
            busMarkers.push(marker);
        }
    });
}

// Fetch bus data
async function fetchBusData() {
    for (let i = 0; i < PROXY_SERVICES.length; i++) {
        CURRENT_PROXY = PROXY_SERVICES[i];
        const url = buildVehicleApiUrl();

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const bufferRes = await response.arrayBuffer();
            const pbf = new Pbf(new Uint8Array(bufferRes));
            const feedMessage = FeedMessage.read(pbf);

            processVehiclePositions(feedMessage);
            return true;
        } catch (error) {
            console.error(`Proxy ${i + 1} failed:`, error);
            if (i === PROXY_SERVICES.length - 1) {
                throw error;
            }
        }
    }
}

// Fetch all data
async function fetchAllData() {
    updateStatus('Loading static data...', 'loading');
    
    try {
        // First, try to fetch static data (stops, routes, shapes)
        let stopsLoaded = false;
        let routesLoaded = false;
        
        try {
            await fetchBusStops();
            stopsLoaded = true;
            updateStatus('Bus stops loaded, fetching routes...', 'loading');
        } catch (error) {
            console.error('Failed to load stops:', error);
            updateStatus('Using fallback stops data', 'loading');
            // Fallback to some major stops if API fails
            delhiBusStops = [
                { id: 'CP', name: "Connaught Place", lat: 28.6315, lng: 77.2167 },
                { id: 'RF', name: "Red Fort", lat: 28.6562, lng: 77.2410 },
                { id: 'IG', name: "India Gate", lat: 28.6129, lng: 77.2295 },
                { id: 'AIIMS', name: "AIIMS", lat: 28.5672, lng: 77.2100 },
                { id: 'KB', name: "Karol Bagh", lat: 28.6519, lng: 77.1909 }
            ];
        }

        try {
            await fetchBusRoutes();
            routesLoaded = true;
            updateStatus('Routes loaded, fetching shapes...', 'loading');
            
            // Try to fetch route shapes (optional)
            await fetchRouteShapes();
        } catch (error) {
            console.error('Failed to load routes:', error);
            updateStatus('Using fallback routes data', 'loading');
        }
        
        // Load static data onto map
        loadBusStops();
        loadRoutes();
        
        updateStatus('Static data loaded, fetching live buses...', 'loading');
        
        // Fetch live bus data
        await fetchBusData();
        
        const statusMsg = `✅ Loaded: ${busMarkers.length} buses, ${stopMarkers.length} stops, ${routeLines.length} routes`;
        updateStatus(statusMsg, 'connected');
        updateInfo();
        
    } catch (error) {
        console.error('Error loading data:', error);
        updateStatus(`❌ Error: ${error.message}`, 'error');
        
        // Still try to show what we have
        loadBusStops();
        loadRoutes();
        updateInfo();
    }
}

// Update info panel
function updateInfo() {
    document.getElementById('busCount').textContent = busMarkers.length;
    document.getElementById('stopCount').textContent = stopMarkers.length;
    document.getElementById('routeCount').textContent = routeLines.length;
    document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
}

// Auto-refresh functions
function startAutoRefresh(intervalMinutes = 1) {
    stopAutoRefresh();
    autoRefreshInterval = setInterval(fetchAllData, intervalMinutes * 60 * 1000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
}

// Event listeners and initialization
document.addEventListener('DOMContentLoaded', () => {
    initMap();
    fetchAllData();
    startAutoRefresh(1); // Refresh every minute
});

window.addEventListener('beforeunload', stopAutoRefresh);
