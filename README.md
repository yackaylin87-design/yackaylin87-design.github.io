# Mis ventas Terramar

Página privada para llevar el control de ventas por catálogo: productos, clientes, ventas (con varios productos), abonos, pedidos, compras y pagos a Terramar, lista del próximo pedido (con pedido mínimo), regalos de Terramar, gastos (Meta Ads y otros), métricas y respaldos en Excel.

Colecciones en Firestore: `productos`, `clientes`, `ventas`, `abonos`, `entradas` (compras), `pagos`, `gastos`, `regalos`, `lista` (próximo pedido) y `ajustes/general` (pedido mínimo).

- **Dirección:** https://yackaylin87-design.github.io
- **Datos:** Firebase Firestore (proyecto `control-ventas-terramar`), guardados bajo `users/{uid}/...`. Solo el usuario que inició sesión puede leerlos y escribirlos.
- **Inicio de sesión:** Firebase Authentication con correo y contraseña.
- **Publicación:** GitHub Pages desde la rama `main`. Cada cambio que se sube queda en el historial de versiones.

## Estructura

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Estructura de la página y pestañas |
| `css/app.css` | Diseño (colores, tipografía, celular) |
| `js/app.js` | Toda la lógica: cálculos, formularios, tablas, métricas, respaldo |
| `js/store.js` | Conexión con Firebase (y datos de ejemplo para pruebas) |
| `js/config.js` | Datos de configuración de Firebase (no son secretos) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Para instalarla como app en el celular |

## Probar sin tocar los datos reales

Sirve la carpeta en `http://localhost` y abre `http://localhost:PUERTO/?demo=1`. El modo de prueba solo funciona en localhost y usa datos de ejemplo en memoria.

## Reglas de seguridad de Firestore

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
  }
}
```

Al cambiar archivos, sube el número de `CACHE` en `sw.js` (por ejemplo `ventas-v2`) para que los celulares descarguen la versión nueva.
