export function stageDuration(milliseconds:number) {
  const seconds=Math.max(0,Math.floor(milliseconds/1000));
  return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value=>String(value).padStart(2,"0")).join(":");
}
export function LiveStageTimer({openedAt,closedAt,endsAt,active,now,remainingFirst=false,className=""}: {
  openedAt?:number;closedAt?:number;endsAt?:number|null;active:boolean;now:number;remainingFirst?:boolean;className?:string;
}) {
  const elapsed=stageDuration((closedAt??now)-(openedAt??now));
  const remaining=active&&!!endsAt;
  return <div className={"live-stage-timer "+className}>
    <span>{remainingFirst&&remaining?"남은 시간":active?"경과 시간":"진행 시간"}</span>
    <time>{remainingFirst&&remaining?stageDuration(Math.max(0,endsAt!-now)+999):elapsed}</time>
    {remaining&&<small>{remainingFirst?"경과 ":"남은 "}<time>{remainingFirst?elapsed:stageDuration(Math.max(0,endsAt!-now)+999)}</time></small>}
  </div>;
}
