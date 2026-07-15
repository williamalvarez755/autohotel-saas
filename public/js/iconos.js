// ============================================================
// Iconografía SVG monocroma (trazo 1.75, estilo Lucide).
// Solo presentación: icono('nombre', tamaño) devuelve un <svg>
// que hereda el color del texto (currentColor).
// ============================================================

const ICONOS = {
  // Navegación
  inicio: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  cama: '<path d="M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8"/><path d="M4 10V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4"/><path d="M2 17h20"/><path d="M6 8h4"/>',
  carro: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9-1.8-.5-4.5-1.1-4.5-1.1s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><path d="M9 17h6"/><circle cx="17" cy="17" r="2"/>',
  limpieza: '<path d="M9.9 3.6c.2-.8 1.4-.8 1.6 0l1 3.3c.2.5.6 1 1.2 1.2l3.3 1c.8.2.8 1.4 0 1.6l-3.3 1c-.5.2-1 .6-1.2 1.2l-1 3.3c-.2.8-1.4.8-1.6 0l-1-3.3a2 2 0 0 0-1.2-1.2l-3.3-1c-.8-.2-.8-1.4 0-1.6l3.3-1a2 2 0 0 0 1.2-1.2z"/><path d="M19 13.5v5"/><path d="M16.5 16h5"/>',
  calendario: '<rect x="3" y="4" width="18" height="17" rx="2.5"/><path d="M8 2v4"/><path d="M16 2v4"/><path d="M3 9.5h18"/>',
  paquete: '<path d="M21 8.2v7.6a2 2 0 0 1-1 1.7l-7 4a2 2 0 0 1-2 0l-7-4a2 2 0 0 1-1-1.7V8.2a2 2 0 0 1 1-1.7l7-4a2 2 0 0 1 2 0l7 4a2 2 0 0 1 1 1.7z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  grafica: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 17v-4"/><path d="M13 17V8"/><path d="M18 17v-7"/>',
  usuarios: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
  puerta: '<path d="M13 4h3a2 2 0 0 1 2 2v14"/><path d="M2 20h20"/><path d="M13 20V4a1 1 0 0 0-1.2-1L6.6 4.2A2 2 0 0 0 5 6.2V20"/><path d="M10 12h.01"/>',

  // Estados y avisos
  campana: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  alerta: '<path d="m21.7 18.3-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-2.7z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  reloj: '<circle cx="12" cy="13" r="8"/><path d="M12 9.5V13l2.3 2.3"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.3 2.4 2.4 4.8-5.2"/>',
  palomita: '<path d="M20 6 9 17l-5-5"/>',

  // Dinero y operación
  dinero: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01"/><path d="M18 12h.01"/>',
  banco: '<path d="M3 22h18"/><path d="M6 18v-8"/><path d="M10 18v-8"/><path d="M14 18v-8"/><path d="M18 18v-8"/><path d="m12 2 9 5H3z"/>',
  copa: '<path d="m6 8 1.75 12.3a2 2 0 0 0 2 1.7h4.5a2 2 0 0 0 2-1.7L18 8"/><path d="M5 8h14"/><path d="m12 8 1-6h2"/>',
  recibo: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1z"/><path d="M14 8H8"/><path d="M16 12H8"/><path d="M13 16H8"/>',
  portapapeles: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6"/><path d="M9 16h6"/>',
  lupa: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  refrescar: '<path d="M21 12a9 9 0 1 1-2.9-6.6"/><path d="M21 3v6h-6"/>',

  // Tema y varios
  luna: '<path d="M12 3a6.4 6.4 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  mas: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  menos: '<path d="M5 12h14"/>',
  flecha: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  edificio: '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M2 22h20"/><path d="M10 6h1"/><path d="M13 6h1"/><path d="M10 10h1"/><path d="M13 10h1"/><path d="M10 14h1"/><path d="M13 14h1"/><path d="M10 18h4"/>',
  llave: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3"/>',
  caja: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M3 8 6 4h12l3 4"/><path d="M9 13h6"/>',
  peaton: '<circle cx="12" cy="4" r="1.4"/><path d="m10 21 1.5-6L9 13V9l3-1 3 3 2 1"/><path d="M11.5 15 9.5 21"/>',
  salir: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>'
};

/**
 * Devuelve el SVG del icono pedido con el tamaño dado (px).
 * Hereda el color del texto; alineado para convivir con texto.
 */
function icono(nombre, tam = 20) {
  const trazos = ICONOS[nombre];
  if (!trazos) return '';
  return `<svg class="icono-svg" width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" ` +
    `stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${trazos}</svg>`;
}
