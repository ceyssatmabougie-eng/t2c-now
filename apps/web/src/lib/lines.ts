export type LineCode = string

/**
 * Couleurs officielles des lignes T2C Clermont-Ferrand
 */
export const LINE_COLORS: Record<LineCode, string> = {
  // Tramway (lignes fortes)
  A: '#C1272D',
  B: '#0055A4',
  C: '#00843D',

  // Lignes essentielles
  '1': '#FFD700',
  '2': '#90EE90',
  '3': '#9370DB',
  '4': '#FF8C00',
  '5': '#FF69B4',
  '6': '#00CED1',
  '7': '#8B008B',

  // Lignes structurantes
  '10': '#CD853F',
  '11': '#40E0D0',
  '12': '#FFB6C1',
  '13': '#32CD32',
  '14': '#9370DB',
  '15': '#FFFF00',

  // Lignes de proximité
  '30': '#A8D5BA',
  '31': '#C5B4E3',
  '32': '#FFB3BA',
  '33': '#FFFFBA',
  '34': '#BAFFC9',
  '35': '#FFB3E6',
  '36': '#C4C4FF',
  '37': '#B3D9FF',
  '38': '#B3F0FF',
  '39': '#FFE6B3',
  '40': '#CCFFB3',
  '41': '#D9B3FF',

  // Lignes spéciales
  '81': '#FFD4B3',
  '82': '#FFC4D4',
  '83': '#E6FFB3',
  '84': '#B3E6FF',
}

const FALLBACK_COLOR = '#9E9E9E'

/**
 * Retourne la couleur associée à une ligne
 * @param line Code de la ligne (ex: "A", "E1", "S10")
 * @returns Couleur hexadécimale
 */
export function getLineColor(line: string): string {
  const normalized = line.trim().toUpperCase()
  return LINE_COLORS[normalized] ?? FALLBACK_COLOR
}

/**
 * Détermine si le texte doit être blanc ou noir pour un contraste suffisant
 * @param bgColor Couleur de fond en hexadécimal
 * @returns true si le texte doit être blanc
 */
export function shouldUseWhiteText(bgColor: string): boolean {
  // Parse hex color
  const hex = bgColor.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)

  // Calculate relative luminance (WCAG formula)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255

  // Use white text for dark backgrounds (luminance < 0.5)
  return luminance < 0.5
}
