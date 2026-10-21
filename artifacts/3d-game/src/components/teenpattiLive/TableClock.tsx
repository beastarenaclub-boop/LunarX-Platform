import { useEffect, useState } from "react";

const dateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export default function TableClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 1000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return (
    <div className="tp20-table-clock" data-testid="tp20-table-clock">
      <strong>TEEN-PATTI 2020</strong>
      <span>
        Delhi <small>IST</small>
      </span>
      <time dateTime={now.toISOString()}>
        {dateFormat.format(now)} <b>{timeFormat.format(now)}</b>
      </time>
    </div>
  );
}
