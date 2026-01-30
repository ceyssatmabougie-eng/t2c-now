export type LineCode = string

/**
 * Couleurs officielles des lignes T2C Clermont-Ferrand
 */
export const LINE_COLORS: Record<LineCode, string> = {
  // Lignes principales (Tramway)
  A: '#C1272D',
  B: '#0055A4',
  C: '#00843D',
  BEN: '#003366',

  // Lignes Express
  E1: '#FFD700',
  E2: '#90EE90',
  E3: '#9370DB',
  E4: '#FF8C00',
  E5: '#FF69B4',
  E6: '#00CED1',
  E7: '#8B008B',

  // Lignes Structurantes
  S10: '#CD853F',
  S11: '#40E0D0',
  S12: '#FFB6C1',
  S13: '#32CD32',
  S14: '#9370DB',
  S15: '#FFFF00',

  // Lignes Périurbaines (P30-P41)
  P30: '#A8D5BA',
  P31: '#C5B4E3',
  P32: '#FFB3BA',
  P33: '#FFFFBA',
  P34: '#BAFFC9',
  P35: '#FFB3E6',
  P36: '#C4C4FF',
  P37: '#B3D9FF',
  P38: '#B3F0FF',
  P39: '#FFE6B3',
  P40: '#CCFFB3',
  P41: '#D9B3FF',

  // Lignes Périurbaines (P75-P84)
  P75: '#003366',
  P81: '#FFD4B3',
  P82: '#FFC4D4',
  P83: '#E6FFB3',
  P84: '#B3E6FF',
}

/**
 * Liste des lignes T2C connues (pour filtrer les lignes invalides)
 */
export const KNOWN_LINES = new Set(Object.keys(LINE_COLORS))

const FALLBACK_COLOR = '#9E9E9E'

/**
 * Vérifie si une ligne est une ligne T2C valide
 */
export function isValidLine(line: string): boolean {
  const normalized = line.trim().toUpperCase()
  return KNOWN_LINES.has(normalized)
}

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
