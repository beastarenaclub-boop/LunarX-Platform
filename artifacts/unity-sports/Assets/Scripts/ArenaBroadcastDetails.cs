using UnityEngine;

namespace ArenaSports
{
    public sealed partial class ArenaGeometry
    {
        public Transform CricketUmpireHat(Transform parent)
        {
            var hat=new GameObject("Umpire sun hat").transform;hat.SetParent(parent,false);
            Primitive(PrimitiveType.Cylinder,Vector3.zero,new(.39f,.012f,.39f),White,hat,false);
            Primitive(PrimitiveType.Cylinder,new(0,.065f,0),new(.24f,.06f,.24f),White,hat,false);
            Primitive(PrimitiveType.Cylinder,new(0,.02f,0),new(.245f,.012f,.245f),Dark,hat,false);
            BatchEquipment(hat);return hat;
        }
        public void BroadcastCourtDetails()
        {
            var paint=Material("Midnight blue key",new(.025f,.09f,.19f),.32f);
            foreach(int side in new[]{-1,1})
            {
                Box(new(side*11.1f,-.001f,0),new(5.8f,.012f,4.9f),paint);
                Circle(new(side*8.2f,.021f,0),1.8f,1.8f,.065f);
                for(int j=0;j<64;j++)
                {
                    float a=Mathf.Lerp(-1.36f,1.36f,j/64f),b=Mathf.Lerp(-1.36f,1.36f,(j+1)/64f);
                    Line(new(side*(12.25f-Mathf.Cos(a)*6.75f),.025f,Mathf.Sin(a)*6.75f),new(side*(12.25f-Mathf.Cos(b)*6.75f),.025f,Mathf.Sin(b)*6.75f),.06f);
                }
                Box(new(side*15.5f,.8f,0),new(.55f,1.6f,.8f),paint);
                Box(new(side*12.75f,4.48f,0),new(.12f,.38f,.72f),Dark);
                Box(new(side*12.68f,4.48f,0),new(.015f,.24f,.52f),Accent);
                for(int seat=0;seat<6;seat++)
                {
                    Box(new(side*(3+seat*.8f),.45f,-10.5f),new(.62f,.14f,.62f),paint);
                    Box(new(side*(3+seat*.8f),.82f,-10.8f),new(.62f,.72f,.1f),paint);
                }
            }
            Circle(new(0,.023f,0),1.2f,1.2f,.16f,Accent);
            Box(new(0,1,-11),new(4,1.1f,.8f),Dark);
            for(int side=-1;side<=1;side+=2)
                for(int i=-2;i<=2;i++)Box(new(i*7,12,side*10),new(3,.15f,1),LightPanel);
        }
        public void TennisVenueDetails()
        {
            var blue=Material("Tournament furniture",new(.025f,.11f,.25f),.35f);
            foreach(int side in new[]{-1,1})
            {
                Box(new(side*6,.55f,8),new(3,.15f,.6f),blue);
                Box(new(side*6,.85f,8.3f),new(3,.6f,.1f),blue);
                for(int x=-1;x<=1;x+=2)Rod(new(side*6+x,0,8),new(side*6+x,.5f,8),.05f,Steel);
                Box(new(side*3,.45f,8),new(.6f,.9f,.6f),White);
            }
            // Raised umpire chair and ladder beside the net.
            Box(new(0,2.2f,7.2f),new(.9f,.12f,.8f),blue);
            Box(new(0,2.6f,7.55f),new(.9f,.8f,.12f),blue);
            foreach(int side in new[]{-1,1})Rod(new(side*.4f,0,8),new(side*.4f,2.2f,7.2f),.04f,Steel);
            for(int step=0;step<6;step++)Rod(new(-.4f,.25f+step*.32f,7.9f-step*.12f),new(.4f,.25f+step*.32f,7.9f-step*.12f),.035f,White);
            // Centre strap makes the net's sag and centreline legible.
            Rod(new(0,.04f,0),new(0,1.02f,0),.018f,White);
        }
        public void RaceVenueDetails()
        {
            var blue=Material("Circuit blue",new(.025f,.17f,.32f),.25f);
            for(int i=0;i<80;i++)
            {
                float a=i*Mathf.PI*2/80,b=(i+1)*Mathf.PI*2/80;
                Rod(new(Mathf.Cos(a)*62,.65f,Mathf.Sin(a)*39),new(Mathf.Cos(b)*62,.65f,Mathf.Sin(b)*39),.12f,Steel);
                Rod(new(Mathf.Cos(a)*62,1.05f,Mathf.Sin(a)*39),new(Mathf.Cos(b)*62,1.05f,Mathf.Sin(b)*39),.1f,Steel);
                Rod(new(Mathf.Cos(a)*62,0,Mathf.Sin(a)*39),new(Mathf.Cos(a)*62,2.8f,Mathf.Sin(a)*39),.035f,Steel);
            }
            // Finish-line gantry and chequered track marking.
            Rod(new(44,0,0),new(44,7,0),.2f,Steel);Rod(new(62,0,0),new(62,7,0),.2f,Steel);
            Box(new(53,7,0),new(18,1.2f,.5f),blue);
            for(int i=0;i<5;i++)Sphere(new(49+i*2,6.9f,.3f),.22f,Accent);
            for(int x=0;x<12;x++)for(int z=0;z<2;z++)Box(new(47.5f+x,.022f,z*.65f),new(1,.014f,.65f),(x+z)%2==0?White:Dark);
            for(int bay=0;bay<5;bay++)
            {
                Box(new(-16+bay*8,2.5f,-47),new(7.5f,5,6),Concrete);
                Box(new(-16+bay*8,2,-43.95f),new(6.5f,3.8f,.08f),Dark);
                Box(new(-16+bay*8,4.6f,-43.85f),new(6.5f,.5f,.1f),blue);
            }
        }
        public void FormulaCarDetails(Transform root,Material paint)
        {
            foreach(int side in new[]{-1,1})
            {
                // Sidepods, mirrors, multi-element wings and wheel hubs.
                Box(new(side*.65f,.46f,-.25f),new(.42f,.35f,1.45f),paint,root,false);
                Rod(new(side*.45f,.65f,.45f),new(side*.74f,.78f,.6f),.025f,Steel,root,false);
                Box(new(side*.76f,.8f,.6f),new(.18f,.1f,.23f),paint,root,false);
                for(int wing=0;wing<3;wing++)Box(new(side*.53f,.2f+wing*.055f,2.02f+wing*.13f),new(.95f,.035f,.19f),paint,root,false);
                for(int axle=-1;axle<=1;axle+=2)
                {
                    var hub=Primitive(PrimitiveType.Cylinder,new(side*1.14f,.35f,axle*1.25f),new(.34f,.012f,.34f),Steel,root,false);
                    hub.transform.localRotation=Quaternion.Euler(0,0,90);
                }
            }
            Box(new(0,.83f,-1.55f),new(1.8f,.04f,.18f),Dark,root,false);
            Sphere(new(0,.83f,-.055f),.10f,LightPanel,root,false);
        }
    }
}
