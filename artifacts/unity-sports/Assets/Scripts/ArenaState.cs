using System;
using UnityEngine;

namespace ArenaSports
{
    // Presentation only. The website remains the sole authority for clocks,
    // scores, settlements and the virtual coin balance.
    [Serializable] public class ArenaEvent
    {
        public float at;
        public int team;
        public int points;
        public string kind;
        public int[] score;
    }
    [Serializable] public class ArenaState
    {
        public string sport = "football";
        public string camera = "broadcast";
        public string quality = "auto";
        public int followPlayer;
        public float zoom=1;
        public float orbit=35;
        public string phase = "betting";
        public string roundId = "";
        public string venue = "Emerald Park";
        public float elapsed;
        public float duration = 45;
        public string[] colors = { "#b6ef62", "#8e9cff" };
        public ArenaEvent[] events = Array.Empty<ArenaEvent>();
        public int[] order = Array.Empty<int>();
    }

    public static class FootballMotion
    {
        static readonly Vector3[] Formation = {
            new(-49,0,0),new(-31,0,-23),new(-34,0,-8),new(-34,0,8),new(-31,0,23),
            new(-15,0,-20),new(-19,0,0),new(-15,0,20),new(0,0,-16),new(5,0,0),new(0,0,16)
        };
        static readonly int[] Lanes = { 9,6,5,8,10,7,6,8,9,10 };
        public const float PossessionSeconds=3.6f,ContactSeconds=1.45f,ArrivalSeconds=3.15f;
        // Inside-foot strike measured from the retargeted CMU contact pose.
        public static readonly Vector3 StrikeOffset=new(.54f,.112f,.17f);
        static Vector3 Turn(Vector3 from,Vector3 to,float amount)
        {
            if(from.sqrMagnitude<.00001f)from=to;
            if(to.sqrMagnitude<.00001f)to=from;
            float a=Mathf.Atan2(from.x,from.z)*Mathf.Rad2Deg,b=Mathf.Atan2(to.x,to.z)*Mathf.Rad2Deg;
            float angle=Mathf.LerpAngle(a,b,amount)*Mathf.Deg2Rad;
            return new(Mathf.Sin(angle),0,Mathf.Cos(angle));
        }
        public static int Carrier(int slot)=>(slot/5%2)*11+Lanes[slot%Lanes.Length];
        public static float StrikeTime(float t,int index)
        {
            int slot=Mathf.FloorToInt(Mathf.Max(0,t)/PossessionSeconds);
            float time=t-slot*PossessionSeconds-ContactSeconds+.4f;
            return index==Carrier(slot)&&time>=0&&time<=.8f?time:-1;
        }
        public static Vector3 Facing(int index,float t)
        {
            Vector3 p=Position(index,t,true),velocity=Position(index,t+.025f,true)-p;
            int slot=Mathf.FloorToInt(Mathf.Max(0,t)/PossessionSeconds);
            float local=t-slot*PossessionSeconds;
            if(index==Carrier(slot)&&local<2)
            {
                float begin=slot*PossessionSeconds;
                Vector3 startVelocity=Position(index,begin+.025f,true)-Position(index,begin,true);
                Vector3 pass=Position(Carrier(slot+1),begin+ArrivalSeconds,true)-Position(index,begin+ContactSeconds,true);
                float turn=Mathf.SmoothStep(0,1,Mathf.Clamp01((local-.2f)/.55f));
                return Turn(startVelocity,pass,turn);
            }
            return velocity;
        }
        static Vector3 Control(int index,float t,Vector3 direction)
        {
            if(direction.sqrMagnitude<.0001f)direction=index<11?Vector3.right:Vector3.left;
            direction.y=0;direction.Normalize();
            Vector3 side=Vector3.Cross(Vector3.up,direction);
            return Position(index,t,true)+direction*StrikeOffset.z+side*StrikeOffset.x+Vector3.up*StrikeOffset.y;
        }
        public static Vector3 Kickoff(int index)
        {
            int role=index%11;float sign=index<11?1:-1;
            Vector3 p=Formation[role]*sign;
            if(role==9)p=new(-sign*1.2f,0,0);
            else if(role>=8)p.x=-sign*7;
            return p;
        }
        public static Vector3 Position(int index, float t, bool playing)
        {
            int role = index % 11;
            float sign = index < 11 ? 1 : -1;
            Vector3 p = Formation[role] * sign;
            if (!playing) return Kickoff(index);
            float advance = Mathf.Sin(t * .22f) * 15;
            if (role == 0) return new(sign * (-49 + Mathf.Max(0, sign * advance) * .07f), 0, Mathf.Sin(t * .45f) * 2.1f);
            var moving=new Vector3(Mathf.Clamp(p.x + advance + Mathf.Sin(t*.55f + role*1.7f)*3.2f,-45,45),0,
                Mathf.Clamp(p.z + Mathf.Sin(t*.46f + role*2.3f)*3.2f,-29,29));
            return Vector3.Lerp(Kickoff(index),moving,Mathf.SmoothStep(0,1,t/2.7f));
        }
        public static Vector3 Ball(float t, bool playing, out int carrier, out int receiver, out bool kick)
        {
            carrier = receiver = 9; kick = false;
            if (!playing) return new(0,.112f,0);
            t=Mathf.Max(0,t);
            int slot=Mathf.FloorToInt(t/PossessionSeconds);
            float start=slot*PossessionSeconds,local=t-start;
            carrier=Carrier(slot);receiver=Carrier(slot+1);
            kick=StrikeTime(t,carrier)>=0;
            Vector3 incoming=slot==0?Vector3.forward:(Position(carrier,start,true)-Position(Carrier(slot-1),start-PossessionSeconds+ContactSeconds,true)).normalized;
            Vector3 outgoing=Facing(carrier,start+ContactSeconds);
            if(local<ContactSeconds)
            {
                // First touch blends from the exact previous receiving point.
                Vector3 p=Control(carrier,t,Turn(incoming,outgoing,Mathf.SmoothStep(0,1,local/.55f)));
                if(slot==0&&local<.65f)p=Vector3.Lerp(new(0,.112f,0),p,Mathf.SmoothStep(0,1,local/.65f));
                return p;
            }
            float departure=start+ContactSeconds,arrival=start+ArrivalSeconds;
            Vector3 direction=(Position(receiver,arrival,true)-Position(carrier,departure,true)).normalized;
            Vector3 from=Control(carrier,departure,Facing(carrier,departure));
            // After receiving, the ball travels with that player until the next
            // possession. Both sides of a slot boundary use the same direction.
            Vector3 receivingDirection=(Position(receiver,start+PossessionSeconds,true)-Position(carrier,departure,true)).normalized;
            if(local>=ArrivalSeconds)return Control(receiver,t,receivingDirection);
            Vector3 to=Control(receiver,arrival,receivingDirection);
            float u=(t-departure)/(ArrivalSeconds-ContactSeconds);
            // Mostly constant rolling speed, with a small deceleration on first touch.
            float travel=u*(1.12f-.12f*u);
            Vector3 ball=Vector3.Lerp(from,to,travel);
            ball.y=.112f+Mathf.Sin(u*Mathf.PI)*.045f;
            return ball;
        }
        public static Vector3 Goal(int team, float t)
        {
            float u = Mathf.Clamp01(t/1.05f);
            return new((team==0 ? 1 : -1)*(34+19*u),.112f+Mathf.Sin(u*Mathf.PI)*1.2f,-2.5f+4*u);
        }
    }
}
