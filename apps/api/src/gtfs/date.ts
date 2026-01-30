/**
 * Utilitaires de date pour GTFS - toujours en heure LOCALE
 */

export type Weekday = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'

const WEEKDAY_MAP: Weekday[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * Formate une date en YYYYMMDD (format GTFS) en utilisant l'heure locale
 */
export function formatYyyymmddLocal(d: Date): string {
  const year = d.getFullYear()
  const month = (d.getMonth() + 1).toString().padStart(2, '0')
  const day = d.getDate().toString().padStart(2, '0')
  return `${year}${month}${day}`
}

/**
 * Retourne le jour de la semaine en anglais (format GTFS calendar)
 * Basé sur l'heure locale
 */
export function getWeekdayLocal(d: Date): Weekday {
  return WEEKDAY_MAP[d.getDay()]
}

/**
 * Retourne la date de début du "service day" GTFS.
 * Un service day commence à 03:00 locale et se termine à 02:59:59 le lendemain.
 * Cela permet de gérer les horaires après minuit (ex: 25:30:00 = 01:30 le lendemain).
 *
 * Si now < 03:00, on considère qu'on est encore dans le service day de la veille.
 */
export function getServiceDayDateLocal(now: Date): Date {
  const year = now.getFullYear()
  const month = now.getMonth()
  const day = now.getDate()

  // 03:00 du jour courant
  const startToday = new Date(year, month, day, 3, 0, 0, 0)

  if (now < startToday) {
    // Avant 03:00 -> on est encore dans le service day de la veille
    return new Date(year, month, day - 1, 3, 0, 0, 0)
  }

  return startToday
}
