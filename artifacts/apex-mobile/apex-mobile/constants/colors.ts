/**
 * ApexFinder Mobile — Design Tokens
 * Mirrors the dark obsidian palette from the sibling web artifact (index.css).
 * The app is forced to dark mode; both light/dark keys use the same values.
 */

const colors = {
  light: {
    // Legacy aliases
    text: '#D6DDE9',
    tint: '#10B981',

    // Surfaces
    background: '#0B0F19',
    foreground: '#D6DDE9',

    // Cards
    card: '#141824',
    cardForeground: '#D6DDE9',

    // Primary — emerald green
    primary: '#10B981',
    primaryForeground: '#ffffff',

    // Secondary — electric blue
    secondary: '#3B82F6',
    secondaryForeground: '#ffffff',

    // Muted
    muted: '#1E2332',
    mutedForeground: '#8D9AB5',

    // Accent (same as secondary)
    accent: '#3B82F6',
    accentForeground: '#ffffff',

    // Destructive
    destructive: '#E84040',
    destructiveForeground: '#ffffff',

    // Borders / inputs
    border: '#2A3045',
    input: '#2A3045',

    // Amber — used for GATEKEEPER / hot lead highlights
    amber: '#F59E0B',
  },

  // Border radius in pixels — matches web --radius: 0.25rem → 4px
  radius: 4,
};

export default colors;
