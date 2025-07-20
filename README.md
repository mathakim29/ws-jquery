# jQuery WebSocket Wrapper

A simple jQuery plugin to create and manage WebSocket connections with automatic reconnect and JSON support.

---

## Usage

Create a WebSocket connection like this:

```js
const ws = $("ws://example.com/socket");
```

Send data (objects will be auto-serialized to JSON):

```js
ws.send({ type: "hello", msg: "Hi!" });
```

Listen for messages:

```js
ws.on("messageBatch", messages => {
  messages.forEach(msg => console.log("Received:", msg));
});
```

Listen for connection open/close:

```js
ws.on("open", () => console.log("Connected"));
ws.on("close", () => console.log("Disconnected"));
```

Close the connection manually:

```js
ws.close();
```

---

## Features

* Auto reconnect on disconnect
* JSON serialization/deserialization by default
* Message batching to reduce event spam
* Simple jQuery event interface (`on`, `off`, `once`)

---

## Methods

* `.send(data, priority)` — Send data, optional priority `"normal"` (default) or `"high"`
* `.close()` — Close the connection
* `.isOpen()` — Returns if the connection is open

---

## Events

* `"open"` — Connection opened
* `"close"` — Connection closed
* `"messageBatch"` — Array of received messages
* `"error"` — Errors during connection or send

---

## Example

```js
const ws = $("ws://example.com/socket");

ws.on("open", () => console.log("Connected"));
// Output: Connected

ws.on("messageBatch", msgs => {
  msgs.forEach(msg => console.log("Received:", msg));
  /*
    Output examples:
    Received: { type: "greeting", text: "Hello from server" }
    Received: { type: "update", data: {...} }
  */
});

ws.send({ hello: "world" });
// Sends: '{"hello":"world"}'
```
