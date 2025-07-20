(function (original$) {
  const wsPrefix = /^ws:/i;
  const pools = {};

  function wsWrapper(raw, options = {}) {
    const url = raw.replace(/^ws:/i, "ws://");
    const $events = $({});

    const settings = Object.assign(
      {
        reconnect: true,
        maxRetries: Infinity,
        reconnectDelay: 1000,
        maxReconnectDelay: 30000,
        reconnectBackoffFactor: 1.5,
        reconnectJitter: 0.5,
        autoJson: true,
        heartbeatInterval: 15000,
        heartbeatMessage: "ping",
        connectionTimeout: 5000,
        maxQueueSize: 100,
        rateLimitInterval: 50,
        debug: false,
        inactivityTimeout: 60000,
        batchInterval: 50,
        disableAutoJson: false,
        protocols: undefined,
        sendTimeout: 5000,
        adaptiveBackpressure: true,
        throttleMessage: 0, // ms; 0 means no throttle
        throttleReconnect: 0,
      },
      options,
    );

    let socket;
    let heartbeatTimer;
    let connTimeout;
    let inactivityTimer;
    let sendTimeoutTimer;
    let reconnectDelay = settings.reconnectDelay;
    let retryCount = 0;
    let isOnline = navigator.onLine;
    let lastSend = 0;
    let connectionState = "closed"; // possible: connecting, open, closed, reconnecting

    // Queues for prioritization
    const highPriorityQueue = [];
    const normalQueue = [];
    const batchBuffer = [];

    // --- Logging ---
    function log(...args) {
      if (settings.debug) console.debug("[WS]", ...args);
    }

    // --- Event batching ---
    let batchTimer = null;
    function batchEmit() {
      if (batchBuffer.length) {
        $events.trigger("messageBatch", [batchBuffer.splice(0)]);
      }
      batchTimer = null;
    }

    // --- JSON Parsing/Stringify Helpers ---
    function stringifyData(data) {
      if (settings.customSerialize) {
        try {
          return settings.customSerialize(data);
        } catch {}
      }
      if (settings.disableAutoJson) return data;
      if (!(data instanceof ArrayBuffer || data instanceof Blob)) {
        try {
          return JSON.stringify(data);
        } catch {}
      }
      return data;
    }

    function parseData(data) {
      if (settings.customDeserialize) {
        try {
          return settings.customDeserialize(data);
        } catch {}
      }
      if (settings.disableAutoJson) return data;
      if (typeof data === "string") {
        try {
          return JSON.parse(data);
        } catch {}
      }
      return data;
    }

    function throttle(func, wait) {
      let last = 0,
        timer = null;
      return function (...args) {
        const now = Date.now();
        if (now - last >= wait) {
          last = now;
          func.apply(this, args);
        } else if (!timer) {
          timer = setTimeout(
            () => {
              last = Date.now();
              timer = null;
              func.apply(this, args);
            },
            wait - (now - last),
          );
        }
      };
    }

    // --- Inactivity handling ---
    function resetInactivityTimer() {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        log("Inactivity timeout reached. Closing socket.");
        closeSocket();
      }, settings.inactivityTimeout);
    }

    // --- Connection handling ---
    function connect() {
      connectionState = "connecting";
      if (!isOnline) {
        log("Offline, skipping connect");
        return;
      }
      $events.trigger("connecting");
      log("Connecting", url);

      socket = settings.protocols
        ? new WebSocket(url, settings.protocols)
        : new WebSocket(url);

      socket.binaryType = "arraybuffer";

      connTimeout = setTimeout(() => {
        log("Connection timeout");
        socket.close();
        $events.trigger("error", [new Error("Connection timeout")]);
        attemptReconnect();
      }, settings.connectionTimeout);

      bindSocketEvents();
    }

    function bindSocketEvents() {
      socket.onopen = (event) => {
        connectionState = "open"; // state - open
        clearTimeout(connTimeout);
        retryCount = 0;
        reconnectDelay = settings.reconnectDelay;
        $events.trigger("open", [event]);
        startHeartbeat();
        flushQueue();
        resetInactivityTimer();
      };

      socket.onmessage = (event) => {
        resetInactivityTimer();

        if (event.data === "ping") {
          socket.send("pong");
          log("Auto pong sent");
          return;
        }
        if (event.data === "pong") {
          log("Pong received");
          return;
        }

        handleMessage(event.data);
      };

      socket.onclose = (event) => {
        connectionState = "closed"; // state - closed
        clearTimeout(connTimeout);
        clearTimeout(inactivityTimer);
        $events.trigger("close", [event]);
        stopHeartbeat();
        if (settings.reconnect) attemptReconnect();
      };

      socket.onerror = (event) => {
        clearTimeout(connTimeout);
        $events.trigger("error", [event]);
      };
    }

    // --- Message handling ---
    function handleMessage(data) {
      if (data instanceof Blob || data instanceof ArrayBuffer) {
        const reader = new FileReader();
        reader.onload = () => {
          let text = reader.result;
          if (!settings.disableAutoJson) {
            try {
              text = JSON.parse(text);
            } catch {}
          }
          $events.trigger("binaryMessage", [text]);
          batchBuffer.push(text);
          if (!batchTimer)
            batchTimer = setTimeout(batchEmit, settings.batchInterval);
        };
        if (data instanceof Blob) {
          reader.readAsText(data);
        } else {
          reader.readAsText(new Blob([data]));
        }
        return;
      }
      const parsed = parseData(data);
      batchBuffer.push(parsed);
      if (!batchTimer)
        batchTimer = setTimeout(batchEmit, settings.batchInterval);
    }

    // --- Heartbeat ---
    function startHeartbeat() {
      if (settings.heartbeatInterval && settings.heartbeatMessage) {
        heartbeatTimer = setInterval(() => {
          if (socket.readyState === 1) {
            socket.send(settings.heartbeatMessage);
            log("Heartbeat sent");
          }
        }, settings.heartbeatInterval);
      }
    }
    function stopHeartbeat() {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    // --- Send queue flushing ---
    function flushQueue() {
      if (socket.readyState !== 1) return;
      const now = Date.now();

      for (const queue of [highPriorityQueue, normalQueue]) {
        while (queue.length) {
          if (now - lastSend < settings.rateLimitInterval) return;
          if (socket.bufferedAmount > 1024 * 1024) {
            log("Backpressure detected, pause sending");
            return;
          }
          if (queue.length > settings.maxQueueSize) {
            log("Queue size too large, dropping message");
            queue.shift();
            continue;
          }
          const msg = queue.shift();
          socket.send(msg);
          lastSend = Date.now();
          log("Sent queued message");
        }
      }
    }

    // --- Send with priority ---
    function send(data, priority = "normal") {
      const queue = priority === "high" ? highPriorityQueue : normalQueue;

      // Detect binary types (ArrayBuffer, Blob)
      const isBinary = data instanceof ArrayBuffer || data instanceof Blob;

      if (!isBinary) {
        data = stringifyData(data);
      }

      if (socket.readyState === 1 && socket.bufferedAmount < 1024 * 1024) {
        const now = Date.now();
        if (now - lastSend >= settings.rateLimitInterval) {
          socket.send(data);
          lastSend = now;
          log("Sent message");
          clearTimeout(sendTimeoutTimer);
          sendTimeoutTimer = setTimeout(() => {
            log("Send timeout occurred");
            $events.trigger("error", [new Error("Send timeout")]);
          }, settings.sendTimeout);
        } else {
          if (queue.length >= settings.maxQueueSize) {
            log("Queue full, dropping message");
            $events.trigger("queueOverflow", [priority]);
            return false;
          }
          queue.push(data);
          log(`Queued message (${priority} priority, rate limit)`);
        }
      } else {
        if (queue.length >= settings.maxQueueSize) {
          log("Queue full, dropping message");
          $events.trigger("queueOverflow", [priority]);
          return false;
        }
        queue.push(data);
        log(`Queued message (${priority} priority, socket not ready)`);
      }
      return true;
    }

    // --- Reconnect logic ---
    function attemptReconnect() {
      if (retryCount >= settings.maxRetries) {
        connectionState = "reconnecting";
        log("Max reconnect retries reached");
        return;
      }
      retryCount++;
      reconnectDelay = Math.min(
        reconnectDelay * settings.reconnectBackoffFactor,
        settings.maxReconnectDelay,
      );
      const jitter = reconnectDelay * settings.reconnectJitter * Math.random();
      const delay = reconnectDelay + jitter;
      log(`Reconnect attempt ${retryCount} in ${delay.toFixed(0)}ms`);
      setTimeout(connect, delay);
      $events.trigger("reconnecting", [retryCount]);
    }

    // --- Close socket ---
    function closeSocket() {
      clearTimeout(connTimeout);
      clearTimeout(inactivityTimer);
      stopHeartbeat();
      if (socket && (socket.readyState === 0 || socket.readyState === 1)) {
        socket.close();
      }
    }

    // --- Network status listeners ---
    window.addEventListener("online", () => {
      isOnline = true;
      log("Network online");
      if (!socket || socket.readyState !== 1) {
        if (settings.reconnect) attemptReconnect();
      }
    });
    window.addEventListener("offline", () => {
      isOnline = false;
      log("Network offline");
    });

    // Start connection immediately
    connect();

    // Return jQuery-like event interface extended with custom methods
    return $events.extend({
      send,
      close: closeSocket,
      isOpen: () => socket && socket.readyState === 1,
      on(event, handler) {
        $events.on(event, handler);
        return this;
      },
      off(event, handler) {
        $events.off(event, handler);
        return this;
      },
      once(event, handler) {
        const h = (...args) => {
          handler.apply(this, args);
          $events.off(event, h);
        };
        $events.on(event, h);
        return this;
      },
      status() {
        return connectionState;
      },

      getStats() {
        return {
          retryCount,
          highPriorityQueueLength: highPriorityQueue.length,
          normalQueueLength: normalQueue.length,
          bufferedAmount: socket ? socket.bufferedAmount : 0,
        };
      },

      getQueueSizes() {
        return {
          highPriority: highPriorityQueue.length,
          normal: normalQueue.length,
          maxQueueSize: settings.maxQueueSize,
        };
      },

      onReconnect(cb) {
        $events.on("reconnecting", cb);
        return this;
      },
    });
  }

  function wsPool(name, url, options) {
    if (pools[name]) return pools[name];
    pools[name] = wsWrapper(url, options);
    return pools[name];
  }

  const $patched = function (arg, ...rest) {
    if (typeof arg === "string" && wsPrefix.test(arg)) {
      return wsWrapper(arg, rest[0] || {});
    }
    return original$.apply(this, [arg, ...rest]);
  };

  Object.assign($patched, original$);
  $patched.wsPool = wsPool;
  window.$ = window.jQuery = $patched;
})(jQuery);
