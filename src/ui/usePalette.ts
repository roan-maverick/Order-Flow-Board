import { createContext, useContext } from 'react';
import { PALETTES, type Palette } from './palette';

export const PaletteContext = createContext<Palette>(PALETTES.light);
export const usePalette = () => useContext(PaletteContext);
