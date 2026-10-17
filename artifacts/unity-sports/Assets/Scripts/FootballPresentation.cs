using UnityEngine;

namespace ArenaSports
{
    // Absolute server-relative times make late joins, round changes and browser
    // visibility changes deterministic. The presentation never delays kickoff.
    public static class FootballPresentation
    {
        public static string Stage(float elapsed,string phase)
        {
            if(phase=="result")return "full-time";
            if(phase!="betting")return "live";
            float age=Mathf.Clamp(elapsed+20,0,20);
            return age<9.5f?"walkout":age<12?"lineup":age<19.2f?"taking-positions":"kickoff";
        }
        public static Vector3 Lineup(int index)
        {
            int role=index%11;float side=index<11?-1:1;
            return new(side*(3.3f+role*1.08f),0,-29.7f);
        }
        public static Vector3 Entrance(int index,float elapsed)
        {
            float age=Mathf.Clamp(elapsed+20,0,20),side=index<11?-1:1;
            int role=index%11;
            Vector3 start=new(side*1.05f,0,-38.8f-role*.62f);
            Vector3 lineup=Lineup(index);
            // Follow two orderly columns out of the tunnel, then fan out.
            Vector3 gate=new(side*1.05f,0,-34);
            float first=Vector3.Distance(start,gate),distance=Mathf.Max(0,age-role*.04f)*3;
            float second=Vector3.Distance(gate,lineup);
            Vector3 entry=distance<first?Vector3.Lerp(start,gate,distance/first):Vector3.Lerp(gate,lineup,(distance-first)/second);
            if(age<12)return entry;
            float run=Mathf.SmoothStep(0,1,(age-12)/7.2f);
            return Vector3.Lerp(lineup,FootballMotion.Kickoff(index),run);
        }
        public static Vector3 Official(int index,float elapsed,bool preMatch)
        {
            if(!preMatch)return index==0?new(Mathf.Sin(elapsed*.22f)*15-5,0,-7):new(Mathf.Sin(elapsed*.22f)*25,0,index==1?-34.6f:34.6f);
            float age=Mathf.Clamp(elapsed+20,0,20);
            Vector3 line=new((index-1)*1.25f,0,-29.7f);
            Vector3 start=new((index-1)*1.25f,0,-37.5f);
            if(age<12)return Vector3.Lerp(start,line,Mathf.Clamp01(age/7));
            Vector3 field=index==0?new(-4,0,-7):new(0,0,index==1?-34.6f:34.6f);
            return Vector3.Lerp(line,field,Mathf.SmoothStep(0,1,(age-12)/7.2f));
        }
    }
}
