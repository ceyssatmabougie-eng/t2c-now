-- Schema GTFS pour T2C Now sur Supabase
-- Exécuter dans SQL Editor de Supabase

-- Table des arrêts
CREATE TABLE IF NOT EXISTS stops (
  stop_id TEXT PRIMARY KEY,
  stop_name TEXT NOT NULL,
  stop_lat DOUBLE PRECISION NOT NULL,
  stop_lon DOUBLE PRECISION NOT NULL,
  location_type INTEGER DEFAULT 0,
  parent_station TEXT
);

-- Table des lignes
CREATE TABLE IF NOT EXISTS routes (
  route_id TEXT PRIMARY KEY,
  route_short_name TEXT,
  route_long_name TEXT,
  route_type INTEGER
);

-- Table des trajets
CREATE TABLE IF NOT EXISTS trips (
  trip_id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL REFERENCES routes(route_id),
  service_id TEXT NOT NULL,
  trip_headsign TEXT,
  direction_id INTEGER
);

-- Table des horaires
CREATE TABLE IF NOT EXISTS stop_times (
  id SERIAL PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips(trip_id),
  stop_id TEXT NOT NULL REFERENCES stops(stop_id),
  arrival_time TEXT,
  departure_time TEXT NOT NULL,
  stop_sequence INTEGER NOT NULL
);

-- Table calendrier
CREATE TABLE IF NOT EXISTS calendar (
  service_id TEXT PRIMARY KEY,
  monday INTEGER NOT NULL,
  tuesday INTEGER NOT NULL,
  wednesday INTEGER NOT NULL,
  thursday INTEGER NOT NULL,
  friday INTEGER NOT NULL,
  saturday INTEGER NOT NULL,
  sunday INTEGER NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL
);

-- Table exceptions calendrier
CREATE TABLE IF NOT EXISTS calendar_dates (
  id SERIAL PRIMARY KEY,
  service_id TEXT NOT NULL,
  date TEXT NOT NULL,
  exception_type INTEGER NOT NULL
);

-- Index pour les performances
CREATE INDEX IF NOT EXISTS idx_stops_location ON stops(stop_lat, stop_lon);
CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON stop_times(stop_id);
CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON stop_times(trip_id);
CREATE INDEX IF NOT EXISTS idx_trips_route ON trips(route_id);
CREATE INDEX IF NOT EXISTS idx_trips_service ON trips(service_id);
CREATE INDEX IF NOT EXISTS idx_calendar_dates_date ON calendar_dates(date);
CREATE INDEX IF NOT EXISTS idx_calendar_dates_service ON calendar_dates(service_id);

-- Activer RLS mais autoriser lecture publique
ALTER TABLE stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE stop_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_dates ENABLE ROW LEVEL SECURITY;

-- Politiques de lecture publique
CREATE POLICY "Public read stops" ON stops FOR SELECT USING (true);
CREATE POLICY "Public read routes" ON routes FOR SELECT USING (true);
CREATE POLICY "Public read trips" ON trips FOR SELECT USING (true);
CREATE POLICY "Public read stop_times" ON stop_times FOR SELECT USING (true);
CREATE POLICY "Public read calendar" ON calendar FOR SELECT USING (true);
CREATE POLICY "Public read calendar_dates" ON calendar_dates FOR SELECT USING (true);

-- Fonction pour trouver les arrêts proches
CREATE OR REPLACE FUNCTION get_nearby_stops(
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  radius_meters INTEGER DEFAULT 800
)
RETURNS TABLE (
  stop_id TEXT,
  stop_name TEXT,
  stop_lat DOUBLE PRECISION,
  stop_lon DOUBLE PRECISION,
  distance_meters DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.stop_id,
    s.stop_name,
    s.stop_lat,
    s.stop_lon,
    (6371000 * acos(
      cos(radians(lat)) * cos(radians(s.stop_lat)) *
      cos(radians(s.stop_lon) - radians(lon)) +
      sin(radians(lat)) * sin(radians(s.stop_lat))
    )) AS distance_meters
  FROM stops s
  WHERE s.location_type = 0 OR s.location_type IS NULL
  HAVING (6371000 * acos(
      cos(radians(lat)) * cos(radians(s.stop_lat)) *
      cos(radians(s.stop_lon) - radians(lon)) +
      sin(radians(lat)) * sin(radians(s.stop_lat))
    )) <= radius_meters
  ORDER BY distance_meters
  LIMIT 20;
END;
$$ LANGUAGE plpgsql;
