using UnityEngine;

namespace ArenaSports
{
    // Equipment is positioned in metres after animation, independent of FBX bone scale.
    [DefaultExecutionOrder(100)]
    public sealed class CricketPlayerDetails : MonoBehaviour
    {
        Transform head,chest,leftShin,rightShin,leftFoot,rightFoot,leftHand,rightHand;
        Transform leftArm,rightArm,leftElbow,rightElbow;
        Transform hat,leftPad,rightPad,leftGlove,rightGlove,bat,collar;
        Material trim;
        int role;
        float cycle;
        bool live;
        public void Initialize(ArenaGeometry geometry,int index,Color teamColor)
        {
            role=index;
            foreach(var bone in GetComponentsInChildren<Transform>())
            {
                switch(bone.name)
                {
                    case "Head":head=bone;break;case "Chest":chest=bone;break;
                    case "Shin.L":leftShin=bone;break;case "Shin.R":rightShin=bone;break;
                    case "Foot.L":leftFoot=bone;break;case "Foot.R":rightFoot=bone;break;
                    case "Hand.L":leftHand=bone;break;case "Hand.R":rightHand=bone;break;
                    case "Arm.L":leftArm=bone;break;case "Arm.R":rightArm=bone;break;
                    case "Forearm.L":leftElbow=bone;break;case "Forearm.R":rightElbow=bone;break;
                }
            }
            trim=geometry.Material("Cricket team trim "+index,teamColor*.65f,.22f);
            hat=geometry.CricketCap(index<2?geometry.Material("Navy batting helmet "+index,new(.025f,.045f,.08f),.35f):trim,index<2||index==3,transform).transform;
            collar=new GameObject("Collar piping").transform;collar.SetParent(transform,false);
            geometry.Rod(new(-.065f,0,0),new(0,-.07f,.035f),.008f,trim,collar,false);
            geometry.Rod(new(.065f,0,0),new(0,-.07f,.035f),.008f,trim,collar,false);
            if(index<2||index==3)
            {
                var leather=geometry.Material("White cricket protection "+index,new(.95f,.97f,.96f),.18f);
                leftPad=Pad(geometry,leather);rightPad=Pad(geometry,leather);
                leftGlove=geometry.Sphere(Vector3.zero,.057f,leather,transform,false).transform;
                rightGlove=geometry.Sphere(Vector3.zero,.057f,leather,transform,false).transform;
                leftGlove.localScale=new(.14f,.1f,.2f);rightGlove.localScale=leftGlove.localScale;
            }
            if(index<2)
            {
                bat=new GameObject("Shaped willow cricket bat").transform;bat.SetParent(transform,false);
                var wood=geometry.Material("Pale willow "+index,new(.80f,.68f,.45f),.2f);
                geometry.Box(new(0,-.38f,0),new(.108f,.56f,.045f),wood,bat,false);
                var spine=geometry.Box(new(0,-.36f,-.024f),new(.048f,.49f,.025f),wood,bat,false);
                spine.transform.localRotation=Quaternion.Euler(-2,0,0);
                geometry.Rod(new(0,-.1f,0),new(0,.16f,0),.017f,trim,bat,false);
                for(int j=0;j<12;j++)geometry.Rod(new(-.017f,-.09f+j*.02f,.012f),new(.017f,-.09f+j*.02f,.012f),.002f,geometry.Dark,bat,false);
                geometry.Box(new(0,-.22f,.024f),new(.075f,.085f,.002f),trim,bat,false);
            }
            geometry.BatchEquipment(hat);geometry.BatchEquipment(collar);
            if(leftPad){geometry.BatchEquipment(leftPad);geometry.BatchEquipment(rightPad);}
            if(bat)geometry.BatchEquipment(bat);
        }
        Transform Pad(ArenaGeometry g,Material leather)
        {
            var root=new GameObject("Ribbed batting pad").transform;root.SetParent(transform,false);
            g.Box(Vector3.zero,new(.16f,.38f,.07f),leather,root,false);
            for(int i=-2;i<=2;i++)g.Rod(new(i*.029f,-.17f,.037f),new(i*.029f,.17f,.037f),.013f,leather,root,false);
            g.Sphere(new(0,.19f,.015f),.085f,leather,root,false).transform.localScale=new(.175f,.13f,.095f);
            for(int i=-1;i<=1;i+=2)g.Box(new(0,i*.105f,-.041f),new(.18f,.025f,.013f),trim,root,false);
            return root;
        }
        public void SetTeamColor(Color color){if(trim)trim.SetColor("_BaseColor",color*.65f);}
        public void SetDelivery(float time,bool playing){cycle=time;live=playing;}
        Vector3 World(Vector3 local)=>transform.position+transform.rotation*local;
        static void Reach(Transform shoulder,Transform elbow,Transform hand,Vector3 target,Vector3 pole)
        {
            if(!shoulder||!elbow||!hand)return;
            Vector3 origin=shoulder.position,delta=target-origin;
            float upper=Vector3.Distance(origin,elbow.position),lower=Vector3.Distance(elbow.position,hand.position);
            if(upper<.01f||lower<.01f)return;
            float distance=Mathf.Clamp(delta.magnitude,.02f,upper+lower-.005f);
            Vector3 direction=delta.normalized,bend=Vector3.ProjectOnPlane(pole-origin,direction).normalized;
            float along=(upper*upper-lower*lower+distance*distance)/(2*distance);
            Vector3 joint=origin+direction*along+bend*Mathf.Sqrt(Mathf.Max(0,upper*upper-along*along));
            shoulder.rotation=Quaternion.FromToRotation(elbow.position-origin,joint-origin)*shoulder.rotation;
            elbow.rotation=Quaternion.FromToRotation(hand.position-elbow.position,target-elbow.position)*elbow.rotation;
        }
        void LateUpdate()
        {
            if(!head)return;
            if(role<2)
            {
                float swing=role==0&&live?Mathf.Sin(Mathf.Clamp01((cycle-1.72f)/.72f)*Mathf.PI):0;
                Vector3 grip=World(new(.17f-swing*.42f,.94f+swing*.48f,.25f+swing*.24f));
                Reach(rightArm,rightElbow,rightHand,grip,World(new(.5f,1.1f,.25f)));
                Reach(leftArm,leftElbow,leftHand,grip+transform.up*.085f,World(new(-.5f,1.1f,.25f)));
                if(bat&&rightHand)
                {
                    bat.position=rightHand.position;
                    bat.rotation=transform.rotation*Quaternion.Euler(-12-swing*115,0,-12+swing*20);
                }
            }
            else if(role==3)
            {
                Reach(rightArm,rightElbow,rightHand,World(new(.22f,.7f,.48f)),World(new(.6f,.85f,.2f)));
                Reach(leftArm,leftElbow,leftHand,World(new(-.22f,.7f,.48f)),World(new(-.6f,.85f,.2f)));
            }
            else if(role==2&&live&&cycle>.65f&&cycle<1.55f)
            {
                float phase=Mathf.InverseLerp(.65f,1.55f,cycle)*Mathf.PI*1.6f;
                Reach(rightArm,rightElbow,rightHand,World(new(.22f,1.38f+Mathf.Sin(phase)*.64f,-Mathf.Cos(phase)*.6f)),World(new(.55f,1.7f,0)));
            }
            hat.position=head.position+transform.up*.19f;hat.rotation=transform.rotation;
            if(chest){collar.position=chest.position+transform.rotation*new Vector3(0,.15f,.11f);collar.rotation=transform.rotation;}
            PositionPad(leftPad,leftShin,leftFoot);PositionPad(rightPad,rightShin,rightFoot);
            if(leftGlove&&leftHand){leftGlove.position=leftHand.position;leftGlove.rotation=transform.rotation;}
            if(rightGlove&&rightHand){rightGlove.position=rightHand.position;rightGlove.rotation=transform.rotation;}
        }
        void PositionPad(Transform pad,Transform shin,Transform foot)
        {
            if(!pad||!shin||!foot)return;
            Vector3 up=(shin.position-foot.position).normalized;
            pad.position=Vector3.Lerp(foot.position,shin.position,.56f)+transform.forward*.075f;
            pad.rotation=Quaternion.LookRotation(Vector3.ProjectOnPlane(transform.forward,up),up);
        }
    }
}
