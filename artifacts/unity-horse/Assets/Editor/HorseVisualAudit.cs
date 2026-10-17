using System.IO;
using HorseRacing;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

// Render in Play mode before the slower IL2CPP build, using the same runtime scene.
[InitializeOnLoad]
public static class HorseVisualAudit
{
    const string Pending="HorseVisualAuditPending";
    static int frame;
    static HorseVisualAudit() { if(SessionState.GetBool(Pending,false))EditorApplication.update+=Tick; }
    public static void Begin()
    {
        ShaderUtil.allowAsyncCompilation=false;
        HorseBuild.Prepare();SessionState.SetBool(Pending,true);EditorApplication.isPlaying=true;
    }
    static void Tick()
    {
        if(!EditorApplication.isPlaying)return;
        var bridge=Object.FindAnyObjectByType<HorseBridge>();var camera=Camera.main;
        if(!bridge)return;
        foreach(var candidate in Object.FindObjectsByType<Camera>())if(candidate.name=="Race broadcast camera")camera=candidate;
        if(!camera)return;
        ShaderUtil.allowAsyncCompilation=false;
        frame++;
        if(frame==8||frame==110||frame==190)
        {
            var state=new RaceFrame{venue=frame==110?"night":"royal",camera="closeup",round="visual-audit",running=frame!=190,elapsed=8,runners=new RunnerFrame[8]};
            for(int i=0;i<8;i++)
            {
                var position=HorseWorld.Track(.025f+i*.0035f,35+i*1.6f);
                state.runners[i]=new RunnerFrame{id=i+1,x=position.x,z=position.z,heading=90,gait=.12f+i*.15f};
            }
            camera.aspect=16f/9;bridge.SetState(JsonUtility.ToJson(state));
        }
        if(frame==100||frame==180||frame==250)
        {
            bridge.SendMessage("LateUpdate");
            ShaderUtil.allowAsyncCompilation=false;
            var target=new RenderTexture(1440,810,24,RenderTextureFormat.ARGB32);target.Create();
            RenderPipeline.SubmitRenderRequest(camera,new UniversalRenderPipeline.SingleCameraRequest{destination=target});
            RenderTexture.active=target;var pixels=new Texture2D(1440,810,TextureFormat.RGB24,false);
            pixels.ReadPixels(new Rect(0,0,1440,810),0,0);pixels.Apply();
            var path=Path.GetFullPath("../../tmp/unity-horse/review/editor-"+(frame==100?"daylight":frame==180?"floodlit":"paddock")+".png");
            Directory.CreateDirectory(Path.GetDirectoryName(path));File.WriteAllBytes(path,pixels.EncodeToPNG());
            RenderTexture.active=null;Object.Destroy(pixels);target.Release();Object.Destroy(target);Debug.Log("HORSE_VISUAL_AUDIT "+path);
        }
        if(frame>253){SessionState.SetBool(Pending,false);EditorApplication.update-=Tick;EditorApplication.Exit(0);}
    }
}
