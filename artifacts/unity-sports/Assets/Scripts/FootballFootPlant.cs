using UnityEngine;

namespace ArenaSports
{
    // Solve only the support foot, after the captured animation has been
    // evaluated. Releasing an anchor on a turn/seek prevents stretched legs.
    public sealed class FootballFootPlant
    {
        readonly Transform upper,lower,foot,root;
        Vector3 anchor;
        bool planted;
        float weight;
        public FootballFootPlant(Transform upper,Transform lower,Transform foot,Transform root)
        {this.upper=upper;this.lower=lower;this.foot=foot;this.root=root;}
        public void Apply(float dt,float floor,bool support)
        {
            if(!upper||!lower||!foot)return;
            Vector3 current=foot.position;
            float height=current.y-floor;
            if(planted&&(!support||height>.075f||Vector2.Distance(new(current.x,current.z),new(anchor.x,anchor.z))>.26f))planted=false;
            if(!planted&&support&&height<.035f){anchor=current;anchor.y=floor;planted=true;}
            weight=Mathf.MoveTowards(weight,planted?1:0,Mathf.Min(dt,.1f)*18);
            if(weight<=0)return;
            Vector3 target=Vector3.Lerp(current,anchor,weight);
            Quaternion footRotation=foot.rotation;
            Vector3 hip=upper.position,knee=lower.position;
            float a=Vector3.Distance(hip,knee),b=Vector3.Distance(knee,current);
            Vector3 ray=target-hip;
            float d=Mathf.Clamp(ray.magnitude,.08f,a+b-.002f);
            Vector3 direction=ray.normalized;
            Vector3 bend=Vector3.ProjectOnPlane(knee-hip,direction);
            if(bend.sqrMagnitude<.00001f)bend=Vector3.ProjectOnPlane(root.forward,direction);
            bend.Normalize();
            float along=(a*a+d*d-b*b)/(2*d);
            Vector3 solvedKnee=hip+direction*along+bend*Mathf.Sqrt(Mathf.Max(0,a*a-along*along));
            upper.rotation=Quaternion.FromToRotation(knee-hip,solvedKnee-hip)*upper.rotation;
            lower.rotation=Quaternion.FromToRotation(foot.position-lower.position,target-lower.position)*lower.rotation;
            foot.rotation=footRotation;
        }
    }
}
