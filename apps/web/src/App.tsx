import { useState, useEffect, useRef } from 'react'
import {
  fetchStopsNear,
  fetchStopsSearch,
  fetchDirections,
  fetchNextDepartures,
  type StopNear,
  type StopSearchResult,
  type DirectionOption,
  type Departure,
} from './lib/api'
import {
  loadFavorites,
  addFavorite,
  removeFavorite,
  isFavorite,
  createFavoriteId,
  type Favorite,
} from './lib/favorites'
import { getLineColor, shouldUseWhiteText } from './lib/lines'
import './App.css'

interface SelectedStop {
  id: string
  name: string
}

interface SelectedDirection {
  id: string
  headsign: string
  line: string
}

type Screen = 'stops' | 'directions' | 'departures'

type StopsState =
  | { status: 'idle' }
  | { status: 'locating' }
  | { status: 'loading' }
  | { status: 'success'; stops: StopNear[] }
  | { status: 'error'; message: string }

type DirectionsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; directions: DirectionOption[] }
  | { status: 'error'; message: string }

type DeparturesState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; departures: Departure[] }
  | { status: 'error'; message: string }

type SearchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; results: StopSearchResult[] }
  | { status: 'error'; message: string }

function getGeolocationErrorMessage(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return 'Accès à la localisation refusé. Veuillez autoriser la géolocalisation.'
    case error.POSITION_UNAVAILABLE:
      return 'Position indisponible. Vérifiez votre GPS ou connexion.'
    case error.TIMEOUT:
      return 'Délai dépassé. Réessayez.'
    default:
      return 'Erreur de géolocalisation inconnue.'
  }
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`
  }
  return `${(meters / 1000).toFixed(1)} km`
}

function formatMinutes(minutes: number): string {
  if (minutes === 0) {
    return 'Imminent'
  }
  if (minutes === 1) {
    return 'Dans 1 min'
  }
  return `Dans ${minutes} min`
}

function formatUpdateTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

function formatDelay(delayMinutes: number): string {
  if (delayMinutes > 0) {
    return `+${delayMinutes} min`
  }
  return `${delayMinutes} min`
}

function App() {
  const [screen, setScreen] = useState<Screen>('stops')
  const [stopsState, setStopsState] = useState<StopsState>({ status: 'idle' })
  const [directionsState, setDirectionsState] = useState<DirectionsState>({ status: 'idle' })
  const [departuresState, setDeparturesState] = useState<DeparturesState>({ status: 'idle' })
  const [selectedStop, setSelectedStop] = useState<SelectedStop | null>(null)
  const [selectedDirection, setSelectedDirection] = useState<SelectedDirection | null>(null)
  const [favorites, setFavorites] = useState<Favorite[]>(() => loadFavorites())
  const [searchQuery, setSearchQuery] = useState('')
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' })
  const searchAbortRef = useRef<AbortController | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchState({ status: 'idle' })
      return
    }

    const debounceTimer = setTimeout(async () => {
      if (searchAbortRef.current) {
        searchAbortRef.current.abort()
      }
      searchAbortRef.current = new AbortController()

      setSearchState({ status: 'loading' })

      try {
        const results = await fetchStopsSearch(searchQuery.trim(), 10)
        setSearchState({ status: 'success', results })
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          return
        }
        const message =
          error instanceof Error ? error.message : 'Erreur lors de la recherche'
        setSearchState({ status: 'error', message })
      }
    }, 300)

    return () => {
      clearTimeout(debounceTimer)
    }
  }, [searchQuery])

  // Auto-refresh departures every 30 seconds when on departures screen
  useEffect(() => {
    if (screen !== 'departures' || !selectedStop || !selectedDirection) {
      return
    }

    const refreshDepartures = async () => {
      setIsRefreshing(true)
      setRefreshError(null)

      try {
        const response = await fetchNextDepartures(selectedStop.id, selectedDirection.id, 5)
        setDeparturesState({ status: 'success', departures: response.departures })
        setLastUpdated(new Date())
        setRefreshError(null)
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Impossible d\'actualiser'
        setRefreshError(message)
      } finally {
        setIsRefreshing(false)
      }
    }

    const intervalId = setInterval(refreshDepartures, 30000)

    return () => {
      clearInterval(intervalId)
    }
  }, [screen, selectedStop, selectedDirection])

  const handleManualRefresh = async () => {
    if (!selectedStop || !selectedDirection || isRefreshing) return

    setIsRefreshing(true)
    setRefreshError(null)

    try {
      const response = await fetchNextDepartures(selectedStop.id, selectedDirection.id, 5)
      setDeparturesState({ status: 'success', departures: response.departures })
      setLastUpdated(new Date())
      setRefreshError(null)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Impossible d\'actualiser'
      setRefreshError(message)
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleLocate = () => {
    if (!navigator.geolocation) {
      setStopsState({
        status: 'error',
        message: "La géolocalisation n'est pas supportée par votre navigateur.",
      })
      return
    }

    setStopsState({ status: 'locating' })

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setStopsState({ status: 'loading' })

        try {
          const stops = await fetchStopsNear(
            position.coords.latitude,
            position.coords.longitude,
            800
          )
          setStopsState({ status: 'success', stops })
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Erreur lors du chargement des arrêts'
          setStopsState({ status: 'error', message })
        }
      },
      (error) => {
        setStopsState({
          status: 'error',
          message: getGeolocationErrorMessage(error),
        })
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    )
  }

  const handleSelectStop = async (stop: StopNear) => {
    setSelectedStop({ id: stop.id, name: stop.name })
    setScreen('directions')
    setDirectionsState({ status: 'loading' })

    try {
      const directions = await fetchDirections(stop.id)
      setDirectionsState({ status: 'success', directions })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erreur lors du chargement des directions'
      setDirectionsState({ status: 'error', message })
    }
  }

  const handleSelectSearchResult = async (result: StopSearchResult) => {
    setSelectedStop({ id: result.id, name: result.name })
    setSearchQuery('')
    setSearchState({ status: 'idle' })
    setScreen('directions')
    setDirectionsState({ status: 'loading' })

    try {
      const directions = await fetchDirections(result.id)
      setDirectionsState({ status: 'success', directions })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erreur lors du chargement des directions'
      setDirectionsState({ status: 'error', message })
    }
  }

  const handleSelectDirection = async (direction: DirectionOption) => {
    if (!selectedStop) return

    setSelectedDirection({
      id: direction.id,
      headsign: direction.headsign,
      line: direction.line,
    })
    setScreen('departures')
    setDeparturesState({ status: 'loading' })
    setLastUpdated(null)
    setRefreshError(null)

    try {
      const response = await fetchNextDepartures(selectedStop.id, direction.id, 5)
      setDeparturesState({ status: 'success', departures: response.departures })
      setLastUpdated(new Date())
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erreur lors du chargement des passages'
      setDeparturesState({ status: 'error', message })
    }
  }

  const handleBackToStops = () => {
    setScreen('stops')
    setSelectedStop(null)
    setSelectedDirection(null)
    setDirectionsState({ status: 'idle' })
    setDeparturesState({ status: 'idle' })
  }

  const handleBackToDirections = () => {
    setScreen('directions')
    setSelectedDirection(null)
    setDeparturesState({ status: 'idle' })
  }

  const handleToggleFavorite = () => {
    if (!selectedStop || !selectedDirection) return

    const favoriteId = createFavoriteId(selectedStop.id, selectedDirection.id)

    if (isFavorite(favoriteId)) {
      const updated = removeFavorite(favoriteId)
      setFavorites(updated)
    } else {
      const favorite: Favorite = {
        id: favoriteId,
        stopId: selectedStop.id,
        stopName: selectedStop.name,
        directionId: selectedDirection.id,
        headsign: selectedDirection.headsign,
        line: selectedDirection.line,
        createdAt: Date.now(),
      }
      const updated = addFavorite(favorite)
      setFavorites(updated)
    }
  }

  const handleSelectFavorite = async (favorite: Favorite) => {
    setSelectedStop({ id: favorite.stopId, name: favorite.stopName })
    setSelectedDirection({
      id: favorite.directionId,
      headsign: favorite.headsign,
      line: favorite.line,
    })
    setScreen('departures')
    setDeparturesState({ status: 'loading' })
    setLastUpdated(null)
    setRefreshError(null)

    try {
      const response = await fetchNextDepartures(favorite.stopId, favorite.directionId, 5)
      setDeparturesState({ status: 'success', departures: response.departures })
      setLastUpdated(new Date())
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Erreur lors du chargement des passages'
      setDeparturesState({ status: 'error', message })
    }
  }

  const handleRemoveFavorite = (favoriteId: string) => {
    const updated = removeFavorite(favoriteId)
    setFavorites(updated)
  }

  const isLocating = stopsState.status === 'locating' || stopsState.status === 'loading'

  const getButtonText = () => {
    if (stopsState.status === 'locating') return 'Localisation en cours...'
    if (stopsState.status === 'loading') return 'Chargement des arrêts...'
    return 'Me localiser'
  }

  return (
    <div className="app">
      <header className="header">
        <h1 className="title">T2C Now</h1>
        <p className="subtitle">Prochains passages à votre arrêt</p>
      </header>

      <main className="main">
        {screen === 'stops' && (
          <>
            {favorites.length > 0 && (
              <section className="favorites-section">
                <h2 className="section-title">Favoris</h2>
                <ul className="favorites-list">
                  {favorites.map((favorite) => {
                    const lineColor = getLineColor(favorite.line)
                    const textColor = shouldUseWhiteText(lineColor) ? '#ffffff' : '#000000'
                    return (
                    <li key={favorite.id} className="favorite-item">
                      <div className="favorite-info">
                        <div className="favorite-line-row">
                          <span
                            className="line-badge"
                            style={{ backgroundColor: lineColor, color: textColor }}
                          >
                            {favorite.line}
                          </span>
                          <span className="favorite-stop">{favorite.stopName}</span>
                        </div>
                        <span className="favorite-direction">
                          → {favorite.headsign}
                        </span>
                      </div>
                      <div className="favorite-actions">
                        <button
                          className="favorite-btn favorite-btn-view"
                          onClick={() => handleSelectFavorite(favorite)}
                        >
                          Voir
                        </button>
                        <button
                          className="favorite-btn favorite-btn-remove"
                          onClick={() => handleRemoveFavorite(favorite.id)}
                        >
                          Supprimer
                        </button>
                      </div>
                    </li>
                    )
                  })}
                </ul>
              </section>
            )}

            <section className="search-section">
              <div className="search-input-wrapper">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Rechercher un arrêt"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    className="search-clear-btn"
                    onClick={() => {
                      setSearchQuery('')
                      setSearchState({ status: 'idle' })
                    }}
                    aria-label="Effacer la recherche"
                  >
                    ×
                  </button>
                )}
              </div>
              <p className="search-help">
                Utile si vous n'êtes pas près d'un arrêt ou si le GPS est désactivé.
              </p>

              {searchState.status === 'loading' && (
                <div className="loading-indicator">
                  <span className="loading-spinner" />
                  <span>Recherche...</span>
                </div>
              )}

              {searchState.status === 'error' && (
                <div className="result-box result-error">
                  <p>{searchState.message}</p>
                </div>
              )}

              {searchState.status === 'success' && searchState.results.length === 0 && (
                <p className="placeholder-text">Aucun arrêt trouvé</p>
              )}

              {searchState.status === 'success' && searchState.results.length > 0 && (
                <ul className="search-results-list">
                  {searchState.results.map((result) => (
                    <li key={result.id}>
                      <button
                        className="search-result-item"
                        onClick={() => handleSelectSearchResult(result)}
                      >
                        <span className="search-result-name">{result.name}</span>
                        {result.kind && (
                          <span className={`search-result-kind ${result.kind}`}>
                            {result.kind === 'station' ? 'Station' : 'Quai'}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <button
              className="action-button"
              onClick={handleLocate}
              disabled={isLocating}
            >
              {getButtonText()}
            </button>

            {stopsState.status === 'error' && (
              <div className="result-box result-error">
                <p>{stopsState.message}</p>
              </div>
            )}

            <section className="stops-section">
              <h2 className="section-title">Arrêts proches</h2>

              {stopsState.status === 'idle' && (
                <p className="placeholder-text">
                  Appuyez sur "Me localiser" pour trouver les arrêts proches
                </p>
              )}

              {(stopsState.status === 'locating' || stopsState.status === 'loading') && (
                <div className="loading-indicator">
                  <span className="loading-spinner" />
                  <span>Recherche en cours...</span>
                </div>
              )}

              {stopsState.status === 'success' && stopsState.stops.length === 0 && (
                <p className="placeholder-text">Aucun arrêt trouvé à proximité</p>
              )}

              {stopsState.status === 'success' && stopsState.stops.length > 0 && (
                <ul className="stops-list">
                  {stopsState.stops.map((stop) => (
                    <li key={stop.id}>
                      <button
                        className="stop-item"
                        onClick={() => handleSelectStop(stop)}
                      >
                        <div className="stop-info">
                          <span className="stop-name">{stop.name}</span>
                          {stop.directions.length > 0 && (
                            <div className="stop-directions">
                              {stop.directions.slice(0, 4).map((dir, idx) => {
                                const lineColor = getLineColor(dir.line)
                                const textColor = shouldUseWhiteText(lineColor) ? '#ffffff' : '#000000'
                                return (
                                  <div key={`${dir.line}-${dir.headsign}-${idx}`} className="stop-direction-item">
                                    <span
                                      className="line-badge line-badge-small"
                                      style={{ backgroundColor: lineColor, color: textColor }}
                                    >
                                      {dir.line}
                                    </span>
                                    <span className="stop-direction-headsign">→ {dir.headsign}</span>
                                  </div>
                                )
                              })}
                              {stop.directions.length > 4 && (
                                <span className="stop-directions-more">+{stop.directions.length - 4} autres</span>
                              )}
                            </div>
                          )}
                        </div>
                        <span className="stop-distance">{formatDistance(stop.distance)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {screen === 'directions' && selectedStop && (
          <>
            <button className="back-button" onClick={handleBackToStops}>
              ← Retour
            </button>

            <section className="directions-section">
              <h2 className="section-title">{selectedStop.name}</h2>
              <p className="section-subtitle">Sélectionnez une direction</p>

              {directionsState.status === 'loading' && (
                <div className="loading-indicator">
                  <span className="loading-spinner" />
                  <span>Chargement des directions...</span>
                </div>
              )}

              {directionsState.status === 'error' && (
                <div className="result-box result-error">
                  <p>{directionsState.message}</p>
                </div>
              )}

              {directionsState.status === 'success' && directionsState.directions.length === 0 && (
                <p className="placeholder-text">Aucune direction disponible</p>
              )}

              {directionsState.status === 'success' && directionsState.directions.length > 0 && (
                <ul className="directions-list">
                  {directionsState.directions.map((direction) => {
                    const lineColor = getLineColor(direction.line)
                    const textColor = shouldUseWhiteText(lineColor) ? '#ffffff' : '#000000'
                    return (
                    <li key={direction.id}>
                      <button
                        className="direction-item"
                        onClick={() => handleSelectDirection(direction)}
                      >
                        <span
                          className="line-badge"
                          style={{ backgroundColor: lineColor, color: textColor }}
                        >
                          {direction.line}
                        </span>
                        <span className="direction-headsign">→ {direction.headsign}</span>
                        <span className="direction-chevron">›</span>
                      </button>
                    </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </>
        )}

        {screen === 'departures' && selectedStop && selectedDirection && (
          <>
            <button className="back-button" onClick={handleBackToDirections}>
              ← Retour
            </button>

            <section className="departures-section">
              <div className="departures-header">
                <h2 className="section-title">{selectedStop.name}</h2>
                <div className="departures-direction">
                  <span
                    className="line-badge"
                    style={{
                      backgroundColor: getLineColor(selectedDirection.line),
                      color: shouldUseWhiteText(getLineColor(selectedDirection.line)) ? '#ffffff' : '#000000'
                    }}
                  >
                    {selectedDirection.line}
                  </span>
                  <span className="direction-arrow">→</span>
                  <span className="direction-headsign-small">{selectedDirection.headsign}</span>
                </div>
              </div>

              <div className="refresh-bar">
                {lastUpdated && (
                  <span className="refresh-time">
                    Mis à jour à {formatUpdateTime(lastUpdated)}
                  </span>
                )}
                <button
                  className="refresh-button"
                  onClick={handleManualRefresh}
                  disabled={isRefreshing || departuresState.status === 'loading'}
                >
                  Actualiser
                </button>
              </div>

              {isRefreshing && (
                <div className="refresh-indicator">
                  <span className="loading-spinner refresh-spinner" />
                  <span>Actualisation...</span>
                </div>
              )}

              {refreshError && !isRefreshing && (
                <div className="refresh-error">
                  {refreshError}
                </div>
              )}

              {isFavorite(createFavoriteId(selectedStop.id, selectedDirection.id)) ? (
                <div className="favorite-status">★ Dans vos favoris</div>
              ) : (
                <button className="favorite-add-btn" onClick={handleToggleFavorite}>
                  ⭐ Ajouter aux favoris
                </button>
              )}

              {departuresState.status === 'loading' && (
                <div className="loading-indicator">
                  <span className="loading-spinner" />
                  <span>Chargement des passages...</span>
                </div>
              )}

              {departuresState.status === 'error' && (
                <div className="result-box result-error">
                  <p>{departuresState.message}</p>
                </div>
              )}

              {departuresState.status === 'success' && departuresState.departures.length === 0 && (
                <p className="placeholder-text">Aucun passage prévu</p>
              )}

              {departuresState.status === 'success' && departuresState.departures.length > 0 && (
                <ul className="departures-list">
                  {departuresState.departures.map((departure, index) => (
                    <li key={index} className="departure-item">
                      <div className="departure-main">
                        <span className="departure-minutes">{formatMinutes(departure.minutes)}</span>
                        <span className="departure-time">{departure.time}</span>
                      </div>
                      <div className="departure-status">
                        <span className={`departure-badge ${departure.realtime ? 'realtime' : 'theoretical'}`}>
                          {departure.realtime ? 'Temps réel' : 'Théorique'}
                        </span>
                        {departure.delayMinutes !== undefined && departure.delayMinutes !== 0 && (
                          <span className={`departure-delay ${departure.delayMinutes > 0 ? 'late' : 'early'}`}>
                            {formatDelay(departure.delayMinutes)}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  )
}

export default App
