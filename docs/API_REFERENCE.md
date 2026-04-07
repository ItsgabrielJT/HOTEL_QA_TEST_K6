# Travel Hotel API Reference

Documentacion funcional de la API observada en el entorno local de Travel Hotel.

Base URL local:

`http://localhost:5173/api/v1`

## Resumen

La API expone un flujo corto de reserva:

1. Consultar habitaciones disponibles.
2. Crear un hold temporal sobre una habitacion.
3. Consultar el hold.
4. Intentar el pago del hold.
5. Si el pago confirma, consultar la reserva generada.

## Convenciones observadas

- Formato: JSON en request y response.
- Fechas: `YYYY-MM-DD` en query params y payloads de entrada.
- Fechas de salida: algunos endpoints responden solo fecha (`2026-04-05`) y otros responden timestamp ISO (`2026-04-05T00:00:00.000Z`).
- Autenticacion: en el contrato actualmente observado no se exige token para los endpoints documentados.
- Estados relevantes:
  - Hold: `PENDING`, `CONFIRMED`
  - Pago: `SUCCESS`, `DECLINED`
  - Reserva: `CONFIRMED`

## Flujo recomendado

1. `GET /rooms/available` para obtener una habitacion libre.
2. `POST /rooms/{roomId}/hold` para bloquearla por un tiempo corto.
3. `GET /holds/{holdId}` para verificar estado y expiracion.
4. `POST /payments` para intentar confirmar el hold.
5. `GET /reservations/{reservationId}` o `GET /reservations?reservation_code=...` para consultar la reserva confirmada.

## Endpoints

### GET /rooms/available

Retorna las habitaciones disponibles en un rango de fechas.

Query params:

| Parametro | Tipo | Obligatorio | Descripcion |
|---|---|---|---|
| checkin | string | Si | Fecha de entrada en formato `YYYY-MM-DD` |
| checkout | string | Si | Fecha de salida en formato `YYYY-MM-DD` |

Ejemplo:

```http
GET /api/v1/rooms/available?checkin=2026-04-10&checkout=2026-04-23
```

Response 200:

```json
[
  {
    "id": "15721d79-fd64-480a-8aa2-4f58abc3a806",
    "room_number": "101",
    "hotel_id": "e2d13a50-bd49-4f9a-821e-643ec5529cdf",
    "type": "SINGLE",
    "price_per_night": "80.00",
    "capacity": 1,
    "amenities": ["wifi", "ac", "tv"],
    "created_at": "2026-04-03T16:19:35.921Z",
    "updated_at": "2026-04-03T16:19:35.921Z"
  }
]
```

Campos de respuesta:

| Campo | Tipo | Descripcion |
|---|---|---|
| id | string UUID | Identificador unico de la habitacion |
| room_number | string | Numero visible de la habitacion |
| hotel_id | string UUID | Hotel al que pertenece |
| type | string | Tipo de habitacion |
| price_per_night | string decimal | Precio por noche |
| capacity | number | Capacidad maxima |
| amenities | array string | Amenidades declaradas |
| created_at | string ISO-8601 | Fecha de creacion |
| updated_at | string ISO-8601 | Fecha de actualizacion |

Errores esperados:

- `400 Bad Request` si las fechas son invalidas.
- `400 Bad Request` si `checkin` esta en el pasado.
- `400 Bad Request` si `checkout` no es posterior a `checkin`.

### POST /rooms/{roomId}/hold

Crea un hold temporal sobre una habitacion para iniciar checkout.

Path params:

| Parametro | Tipo | Obligatorio | Descripcion |
|---|---|---|---|
| roomId | string UUID | Si | Identificador de la habitacion |

Body:

```json
{
  "checkin": "2026-04-04",
  "checkout": "2026-04-05"
}
```

Response 201:

```json
{
  "room_id": "5815336d-f35c-4519-bee4-a32d9e865ed9",
  "checkin": "2026-04-04T00:00:00.000Z",
  "checkout": "2026-04-05T00:00:00.000Z",
  "status": "PENDING",
  "expires_at": "2026-04-04T23:52:59.195Z",
  "payment_id": null,
  "reservation_id": null,
  "id": "53c9fd54-7511-405b-93e1-6ce62aa5a34a",
  "created_at": "2026-04-04T23:42:59.190Z",
  "updated_at": "2026-04-04T23:42:59.190Z"
}
```

Campos de respuesta:

| Campo | Tipo | Descripcion |
|---|---|---|
| id | string UUID | Identificador del hold |
| room_id | string UUID | Habitacion bloqueada |
| checkin | string ISO-8601 | Fecha normalizada de entrada |
| checkout | string ISO-8601 | Fecha normalizada de salida |
| status | string | Estado actual del hold |
| expires_at | string ISO-8601 | Momento en que expira el hold |
| payment_id | string or null | Pago asociado, si existe |
| reservation_id | string or null | Reserva asociada, si existe |
| created_at | string ISO-8601 | Fecha de creacion |
| updated_at | string ISO-8601 | Fecha de actualizacion |

Errores esperados:

- `400 Bad Request` si el rango no es valido.
- `400` o `409` si la habitacion ya no esta disponible para ese rango.

### GET /holds/{holdId}

Consulta el estado actual del hold.

Path params:

| Parametro | Tipo | Obligatorio | Descripcion |
|---|---|---|---|
| holdId | string UUID | Si | Identificador del hold |

Response 200:

```json
{
  "id": "53c9fd54-7511-405b-93e1-6ce62aa5a34a",
  "room_id": "5815336d-f35c-4519-bee4-a32d9e865ed9",
  "checkin": "2026-04-04",
  "checkout": "2026-04-05",
  "status": "PENDING",
  "expires_at": "2026-04-04T23:52:59.195Z",
  "payment_id": null,
  "reservation_id": null,
  "created_at": "2026-04-04T23:42:59.190Z",
  "updated_at": "2026-04-04T23:42:59.190Z",
  "remaining_seconds": 564
}
```

Campos adicionales:

| Campo | Tipo | Descripcion |
|---|---|---|
| remaining_seconds | number | Segundos restantes antes de expirar |

### POST /payments

Procesa el pago de un hold usando una llave de idempotencia.

Body:

```json
{
  "hold_id": "53c9fd54-7511-405b-93e1-6ce62aa5a34a",
  "amount": 85,
  "idempotency_key": "fe28b357-cda9-4091-ba41-201fb71b1f7f"
}
```

Respuesta exitosa observada:

```json
{
  "hold_id": "53c9fd54-7511-405b-93e1-6ce62aa5a34a",
  "idempotency_key": "fe28b357-cda9-4091-ba41-201fb71b1f7f",
  "amount": 85,
  "currency": "USD",
  "status": "SUCCESS",
  "simulator_response": {
    "status": "SUCCESS",
    "message": "Pago aprobado"
  },
  "id": "7ca5b72f-546b-44a5-a27d-25c31a8efcb1",
  "created_at": "2026-04-04T23:45:06.841Z",
  "updated_at": "2026-04-04T23:45:06.841Z"
}
```

Respuesta rechazada observada:

```json
{
  "id": "9aacd8f5-5b18-459c-9e63-9848e1e41a6c",
  "hold_id": "53c9fd54-7511-405b-93e1-6ce62aa5a34a",
  "status": "DECLINED",
  "detail": "Pago rechazado por el banco"
}
```

Codigos observados:

| HTTP | Cuando ocurre |
|---|---|
| 200 | Pago exitoso |
| 402 | Pago rechazado por el simulador |

Notas operativas:

- El endpoint usa `idempotency_key` para evitar reprocesamiento duplicado.
- El simulador de pagos no es completamente determinista; el mismo tipo de request puede terminar en `SUCCESS` o `DECLINED` segun la respuesta del simulador.
- Cuando el pago confirma, el hold queda asociado a una reserva.

### GET /reservations/{reservationId}

Consulta una reserva por ID.

Path params:

| Parametro | Tipo | Obligatorio | Descripcion |
|---|---|---|---|
| reservationId | string UUID | Si | Identificador de la reserva |

Response 200:

```json
{
  "id": "cf9cc98b-5055-43ab-a424-7b9680af4fa7",
  "reservation_code": "0NPLUSYK",
  "room_id": "5815336d-f35c-4519-bee4-a32d9e865ed9",
  "room_number": "102",
  "hotel_id": "e2d13a50-bd49-4f9a-821e-643ec5529cdf",
  "checkin": "2026-04-04",
  "checkout": "2026-04-05",
  "status": "CONFIRMED",
  "price_per_night": 85,
  "nights": 1,
  "total_amount": 85,
  "created_at": "2026-04-04T23:45:06.841Z"
}
```

### GET /reservations

Consulta una reserva por codigo.

Query params:

| Parametro | Tipo | Obligatorio | Descripcion |
|---|---|---|---|
| reservation_code | string | Si | Codigo legible de la reserva |

Ejemplo:

```http
GET /api/v1/reservations?reservation_code=0NPLUSYK
```

Response 200:

```json
{
  "id": "cf9cc98b-5055-43ab-a424-7b9680af4fa7",
  "reservation_code": "0NPLUSYK",
  "room_id": "5815336d-f35c-4519-bee4-a32d9e865ed9",
  "room_number": "102",
  "hotel_id": "e2d13a50-bd49-4f9a-821e-643ec5529cdf",
  "checkin": "2026-04-04",
  "checkout": "2026-04-05",
  "status": "CONFIRMED",
  "price_per_night": 85,
  "nights": 1,
  "total_amount": 85,
  "created_at": "2026-04-04T23:45:06.841Z"
}
```

## Modelo de datos resumido

### Room

```json
{
  "id": "uuid",
  "room_number": "101",
  "hotel_id": "uuid",
  "type": "SINGLE|DOUBLE|SUITE",
  "price_per_night": "80.00",
  "capacity": 1,
  "amenities": ["wifi", "ac"]
}
```

### Hold

```json
{
  "id": "uuid",
  "room_id": "uuid",
  "checkin": "2026-04-04",
  "checkout": "2026-04-05",
  "status": "PENDING|CONFIRMED",
  "expires_at": "2026-04-04T23:52:59.195Z",
  "payment_id": null,
  "reservation_id": null
}
```

### Payment

```json
{
  "id": "uuid",
  "hold_id": "uuid",
  "status": "SUCCESS|DECLINED"
}
```

### Reservation

```json
{
  "id": "uuid",
  "reservation_code": "0NPLUSYK",
  "room_id": "uuid",
  "status": "CONFIRMED",
  "checkin": "2026-04-04",
  "checkout": "2026-04-05",
  "total_amount": 85
}
```

## Archivo Postman

El repo incluye una coleccion y un environment listos para importar en Postman:

- `postman/Travel-Hotel-API.postman_collection.json`
- `postman/Travel-Hotel-Local.postman_environment.json`

Uso recomendado:

1. Importar ambos archivos en Postman.
2. Seleccionar el environment `Travel Hotel Local`.
3. Ejecutar primero `List Available Rooms`.
4. Copiar un `roomId` del response o dejar el valor de ejemplo del environment.
5. Ejecutar `Create Hold` para poblar `holdId` automaticamente.
6. Ejecutar `Get Hold`, `Create Payment` y luego las consultas de reserva si el pago fue exitoso.