import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://mtiyxgopscxqzpfsvuun.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10aXl4Z29wc2N4cXpwZnN2dXVuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njk4MTE0NDYsImV4cCI6MjA4NTM4NzQ0Nn0.MPtjzaTMPLARbsF8jxipFXT40vv57EaNkgKy5qDIHa4'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Types
export interface StopRow {
  stop_id: string
  stop_name: string
  stop_lat: number
  stop_lon: number
  location_type: number | null
  parent_station: string | null
}

export interface RouteRow {
  route_id: string
  route_short_name: string | null
  route_long_name: string | null
}

export interface TripRow {
  trip_id: string
  route_id: string
  service_id: string
  trip_headsign: string | null
  direction_id: number | null
}

export interface StopTimeRow {
  trip_id: string
  stop_id: string
  departure_time: string
  stop_sequence: number
}

export interface CalendarRow {
  service_id: string
  monday: number
  tuesday: number
  wednesday: number
  thursday: number
  friday: number
  saturday: number
  sunday: number
  start_date: string
  end_date: string
}

export interface CalendarDateRow {
  service_id: string
  date: string
  exception_type: number
}
