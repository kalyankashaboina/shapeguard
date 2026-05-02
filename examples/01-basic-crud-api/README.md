# basic-crud-api

> A complete working Express + shapeguard app.
> Shows every v0.2.0 feature working together end-to-end.

## What this example covers

- `createDTO()` — schema definition with auto type inference
- `defineRoute()` with transform hook — password hashed before handler runs
- `handle()` — validate + asyncHandler in one call
- `createRouter()` — auto 405 for wrong HTTP methods
- `AppError` — consistent error throwing from the service layer
- `res.paginated()` — list response with pagination metadata
- `shapeguard()` + `errorHandler()` + `notFoundHandler()` — full app setup

## Run it

```bash
cd examples/basic-crud-api
npm install
npm run dev
```

## Try it

```bash
# Create a user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","name":"Alice","password":"secret123","role":"member"}'

# List users
curl http://localhost:3000/api/users?page=1&limit=10

# Get a user
curl http://localhost:3000/api/users/<id>

# Update a user
curl -X PUT http://localhost:3000/api/users/<id> \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Updated"}'

# Delete a user
curl -X DELETE http://localhost:3000/api/users/<id>

# Wrong method — auto 405
curl -X PATCH http://localhost:3000/api/users
```

## File structure

```
src/
  app.ts                         — Express app setup, shapeguard() mounted once
  validators/
    user.validator.ts            — createDTO(), defineRoute(), transform hook
  controllers/
    user.controller.ts           — handle() usage, res helpers
  routes/
    user.routes.ts               — createRouter(), auto 405
  services/
    user.service.ts              — pure business logic, no shapeguard here
```
