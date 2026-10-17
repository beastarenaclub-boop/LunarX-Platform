import type { LiveMember } from "./types";

export const binaryPosition = (member: LiveMember) =>
  member.parent ? (member.position === "left" ? "Left" : "Right") : "Root";

export default function ReferralPlacement({ member }: { member: LiveMember }) {
  return (
    <dl
      className="referral-placement"
      aria-label={`Referral placement for ${member.name}`}
    >
      <div>
        <dt>Under / Sponsor (upline)</dt>
        <dd>
          {member.sponsor?.name ||
            (member.parent
              ? "Sponsor unavailable"
              : "Workspace owner · no sponsor")}
        </dd>
      </div>
      <div>
        <dt>Referral ID used to join</dt>
        <dd>
          {member.sponsor?.ref ||
            (member.parent ? "Unavailable" : "No referral · root account")}
        </dd>
      </div>
      <div>
        <dt>Binary position</dt>
        <dd>
          {binaryPosition(member)}
          {member.parent ? " position under sponsor" : " · starting account"}
        </dd>
      </div>
    </dl>
  );
}
