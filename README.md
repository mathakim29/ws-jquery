# jQuery WebSocket Wrapper
A simple jQuery plugin to create and manage WebSocket connections with automatic reconnect and JSON support.

---

## Installation
To use the jQuery WebSocket wrapper via CDN, include the following in your HTML:

```html
<!-- jQuery (required) -->
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>

<!-- WebSocket Wrapper (replace with actual CDN URL) -->
<script src="https://github.com/mathakim29/ws-jquery/blob/main/ws-jquery.min.js"></script>
```

Once included, you can use the wrapper like this:

```js
const ws = $("ws://localhost:8000/ws")
  .on("open", () => console.log("Connected"))
  .on("message", msg => console.log("Received:", msg))
  .on("close", () => console.log("Disconnected"));

ws.send({ type: "hello" });
```
## Usage
Create a WebSocket connection like this:

```js
const ws = $("ws://example.com/socket");
```

## Auto-JSON serialization
Send data (objects will be auto-serialized to JSON):
```js
ws.send({ type: "hello", msg: "Hi!" });
```


## Message Queueing
The `.send(data, priority)` method queues messages if the WebSocket connection isn’t open yet or is rate-limited.

### Usage
```js
ws.send({ type: "update", payload: 123 });
````

* `data` can be any JSON-serializable object, string, or binary data (`ArrayBuffer`, `Blob`).
* Messages are automatically JSON-stringified before sending.
* If the socket is not open, messages are stored in an internal queue.
* Queued messages are sent automatically once the connection opens.
* Supports optional `priority` argument (`"normal"` by default, or `"high"`) to prioritize important messages.

### Example
```js
ws.send({ action: "start" }, "high");  // High-priority message
ws.send({ action: "log", info: "debug" }); // Normal priority (default)
```
