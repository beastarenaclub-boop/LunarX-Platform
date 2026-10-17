mergeInto(LibraryManager.library, {
  ArenaStatus: function (pointer) {
    try {
      const message = JSON.parse(UTF8ToString(pointer));
      if (message.type === 'arena-performance') {
        if (window.arenaPerformance) window.arenaPerformance(message);
        return;
      }
      window.parent.postMessage(message, window.location.origin);
    } catch (error) {
      console.error("Unity arena status", error);
    }
  }
});
