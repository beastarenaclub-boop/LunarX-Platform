export type LoginPosition = {
  consent: true;
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number;
};

export function requestLoginLocation(): Promise<LoginPosition> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext || !navigator.geolocation) {
      reject(
        Error(
          "Location is unavailable. Open this portal on HTTPS or localhost in a browser with location support.",
        ),
      );
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          consent: true,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: position.timestamp,
        }),
      (error) =>
        reject(
          Error(
            error.code === 1
              ? "Location permission was denied. Allow Location in this site's browser settings, then retry. Login cannot continue without location."
              : error.code === 3
                ? "Location request timed out. Enable device location, check your connection and retry. Login has not completed."
                : "Your location could not be obtained. Enable device location services and retry. Login has not completed.",
          ),
        ),
      { enableHighAccuracy: false, maximumAge: 0, timeout: 15000 },
    );
  });
}
