using System;
using System.IO;
using System.Linq;
using ArenaSports;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public static class ArenaBuild
{
    const string ResourcesPath="Assets/Resources";
    [Serializable] class SourceMaterial {public string name;public float[] color;public string albedo;public string normal;}
    [Serializable] class MaterialList {public SourceMaterial[] materials;}

    [MenuItem("Arena Sports/Prepare project")]
    public static void Prepare()
    {
        Directory.CreateDirectory("Assets/Scenes");Directory.CreateDirectory("Assets/Settings");
        Directory.CreateDirectory(ResourcesPath+"/Sports/Materials");
        AssetDatabase.Refresh();
        ValidateFootballPresentation();
        CreatePipeline();CreatePrimitives();CreateMaterials();CreateFootballMaterials();CreateSurfaceTextures();CreateCricketWicket();CreateKitNumbers();ImportAthletes();CreatePostProcessing();
        var scene=EditorSceneManager.NewScene(NewSceneSetup.EmptyScene,NewSceneMode.Single);
        new GameObject("ArenaBridge").AddComponent<ArenaBridge>();
        RenderSettings.skybox=AssetDatabase.LoadAssetAtPath<Material>(ResourcesPath+"/ArenaSky.mat");
        EditorSceneManager.SaveScene(scene,"Assets/Scenes/Arena.unity");
        EditorBuildSettings.scenes=new[]{new EditorBuildSettingsScene("Assets/Scenes/Arena.unity",true)};
        PlayerSettings.companyName="Arena Sports";PlayerSettings.productName="Arena Virtual Sports";
        PlayerSettings.defaultScreenWidth=1280;PlayerSettings.defaultScreenHeight=720;
        PlayerSettings.colorSpace=ColorSpace.Linear;
        PlayerSettings.runInBackground=true;
        PlayerSettings.SetScriptingBackend(NamedBuildTarget.WebGL,ScriptingImplementation.IL2CPP);
        PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL,ManagedStrippingLevel.Minimal);
        PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.dataCaching=true;
        PlayerSettings.WebGL.exceptionSupport=WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
        PlayerSettings.WebGL.template="PROJECT:Arena";
        PlayerSettings.WebGL.initialMemorySize=256;
        PlayerSettings.WebGL.maximumMemorySize=1024;
        PlayerSettings.WebGL.memoryGrowthMode=WebGLMemoryGrowthMode.Geometric;
        PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.WebGL,true);
        QualitySettings.shadowDistance=100;QualitySettings.shadowResolution=UnityEngine.ShadowResolution.High;
        QualitySettings.skinWeights=SkinWeights.FourBones;
        AssetDatabase.SaveAssets();
        Debug.Log("ARENA_PROJECT_PREPARED: five sports, URP, WebGL, authoritative browser state");
    }
    static T Save<T>(T asset,string path) where T:UnityEngine.Object
    {
        var old=AssetDatabase.LoadAssetAtPath<T>(path);
        if(old) {EditorUtility.CopySerialized(asset,old);UnityEngine.Object.DestroyImmediate(asset);return old;}
        AssetDatabase.CreateAsset(asset,path);return asset;
    }
    static void CreatePipeline()
    {
        var renderer=Save(ScriptableObject.CreateInstance<UniversalRendererData>(),"Assets/Settings/ArenaRenderer.asset");
        renderer.postProcessData=AssetDatabase.LoadAssetAtPath<PostProcessData>("Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset");
        EditorUtility.SetDirty(renderer);
        var pipeline=UniversalRenderPipelineAsset.Create(renderer);
        pipeline.supportsHDR=true;pipeline.msaaSampleCount=2;pipeline.renderScale=1;
        pipeline.shadowDistance=65;pipeline.shadowCascadeCount=1;
        pipeline.mainLightShadowmapResolution=1024;
        var settings=new SerializedObject(pipeline);
        settings.FindProperty("m_MainLightShadowsSupported").boolValue=true;
        settings.FindProperty("m_SoftShadowsSupported").boolValue=true;
        settings.ApplyModifiedPropertiesWithoutUndo();
        pipeline.supportsCameraDepthTexture=false;pipeline.supportsCameraOpaqueTexture=false;
        pipeline=Save(pipeline,"Assets/Settings/ArenaPipeline.asset");
        GraphicsSettings.defaultRenderPipeline=pipeline;QualitySettings.renderPipeline=pipeline;
        var global=GraphicsSettings.GetSettingsForRenderPipeline<UniversalRenderPipeline>();
        if(!global)
        {
            // URP 17.5 keeps its concrete GlobalSettings type internal. The
            // public creation utility populates all shader/runtime resources.
            var globalType=typeof(UniversalRenderPipelineAsset).Assembly.GetType("UnityEngine.Rendering.Universal.UniversalRenderPipelineGlobalSettings",true);
            global=RenderPipelineGlobalSettingsUtils.Create(globalType,"Assets/Settings/ArenaGlobalSettings.asset");
            UnityEditor.Rendering.EditorGraphicsSettings.SetRenderPipelineGlobalSettingsAsset<UniversalRenderPipeline>(global);
        }
    }
    static void CreateMaterials()
    {
        var shader=Shader.Find("Universal Render Pipeline/Lit");
        if(!shader)throw new InvalidOperationException("URP Lit shader was not imported.");
        var baseMat=new Material(shader);baseMat.SetFloat("_Smoothness",.2f);
        Save(baseMat,ResourcesPath+"/ArenaLit.mat");
        var crowd=new Material(Shader.Find("Universal Render Pipeline/Unlit"));
        crowd.SetFloat("_AlphaClip",1);crowd.SetFloat("_Cutoff",.28f);crowd.SetFloat("_Cull",0);
        crowd.EnableKeyword("_ALPHATEST_ON");crowd.renderQueue=2450;
        crowd.SetTexture("_BaseMap",AssetDatabase.LoadAssetAtPath<Texture2D>(ResourcesPath+"/Sports/Textures/football-fans.png"));
        Save(crowd,ResourcesPath+"/ArenaCrowd.mat");
        var source=JsonUtility.FromJson<MaterialList>(File.ReadAllText(ResourcesPath+"/Sports/materials.json"));
        foreach(var entry in source.materials)
        {
            var material=new Material(shader) {name=entry.name};
            Color color=entry.color?.Length==4 ? new Color(entry.color[0],entry.color[1],entry.color[2],entry.color[3]):Color.white;
            if(!string.IsNullOrEmpty(entry.albedo))
            {
                material.SetTexture("_BaseMap",AssetDatabase.LoadAssetAtPath<Texture2D>(ResourcesPath+"/Sports/Textures/"+entry.albedo));
                color=Color.white;
            }
            material.SetColor("_BaseColor",color);
            material.SetFloat("_Smoothness",entry.name=="HumanSkin"?.3f:.17f);
            if(!string.IsNullOrEmpty(entry.normal))
            {
                material.SetTexture("_BumpMap",AssetDatabase.LoadAssetAtPath<Texture2D>(ResourcesPath+"/Sports/Textures/"+entry.normal));
                material.SetFloat("_BumpScale",entry.name=="HumanSkin"?.45f:.18f);material.EnableKeyword("_NORMALMAP");
            }
            // Hair/eyebrow/eye cards carry alpha in the supplied source textures.
            if(entry.name.Contains("eyebrow") || entry.name.Contains("short01"))
            {
                material.SetFloat("_AlphaClip",1);material.SetFloat("_Cutoff",.3f);
                material.SetFloat("_Cull",0);material.EnableKeyword("_ALPHATEST_ON");material.renderQueue=2450;
            }
            Save(material,ResourcesPath+"/Sports/Materials/"+SafeName(entry.name)+".mat");
        }
        var sky=new Material(Shader.Find("Skybox/Panoramic"));
        sky.SetTexture("_MainTex",AssetDatabase.LoadAssetAtPath<Texture2D>(ResourcesPath+"/Sports/Textures/daylight.hdr"));
        sky.SetFloat("_Exposure",.5f);Save(sky,ResourcesPath+"/ArenaSky.mat");
        var cricketSky=new Material(Shader.Find("Skybox/Procedural"));
        cricketSky.SetColor("_SkyTint",new(.49f,.56f,.65f));cricketSky.SetColor("_GroundColor",new(.41f,.48f,.42f));
        cricketSky.SetFloat("_Exposure",1.25f);cricketSky.SetFloat("_AtmosphereThickness",.85f);
        cricketSky.SetFloat("_SunDisk",2);cricketSky.EnableKeyword("_SUNDISK_HIGH_QUALITY");
        Save(cricketSky,ResourcesPath+"/CricketSky.mat");
        CreateBall(shader);
    }
    static void CreateFootballMaterials()
    {
        var source=JsonUtility.FromJson<MaterialList>(File.ReadAllText(ResourcesPath+"/Sports/football-materials.json"));
        foreach(var entry in source.materials)
        {
            var material=new Material(Shader.Find("Universal Render Pipeline/Lit")){name=entry.name};
            foreach(string file in new[]{entry.albedo,entry.normal})
            {
                if(string.IsNullOrEmpty(file))continue;
                string path=ResourcesPath+"/Sports/Textures/"+file;
                var texture=(TextureImporter)AssetImporter.GetAtPath(path);
                texture.textureType=file.EndsWith("_normal.png")?TextureImporterType.NormalMap:TextureImporterType.Default;
                texture.mipmapEnabled=true;texture.anisoLevel=4;texture.maxTextureSize=2048;texture.SaveAndReimport();
            }
            material.SetTexture("_BaseMap",AssetDatabase.LoadAssetAtPath<Texture2D>(ResourcesPath+"/Sports/Textures/"+entry.albedo));
            if(!string.IsNullOrEmpty(entry.normal))
            {
                material.SetTexture("_BumpMap",AssetDatabase.LoadAssetAtPath<Texture2D>(ResourcesPath+"/Sports/Textures/"+entry.normal));
                material.SetFloat("_BumpScale",entry.name=="FootballUniform"?.08f:.24f);material.EnableKeyword("_NORMALMAP");
            }
            material.SetFloat("_Smoothness",entry.name=="FootballFace"?.28f:entry.name=="HumanSkin"?.24f:.16f);
            Save(material,ResourcesPath+"/Sports/Materials/Football_"+SafeName(entry.name)+".mat");
        }
    }
    static string SafeName(string name)=>string.Concat(name.Select(c=>char.IsLetterOrDigit(c)||c=='-' ? c:'_'));
    static void ValidateFootballPresentation()
    {
        for(int i=0;i<22;i++)
        {
            Vector3 last=FootballPresentation.Entrance(i,-20);
            for(float t=-19.98f;t<=0;t+=.02f)
            {
                Vector3 p=FootballPresentation.Entrance(i,t);
                if(!float.IsFinite(p.x)||!float.IsFinite(p.z)||Mathf.Abs(p.x)>52.5f||p.z < -50||p.z>34)
                    throw new InvalidOperationException("Football entry outside playable venue: "+i);
                if(Vector3.Distance(last,p)>.35f)throw new InvalidOperationException("Football entry discontinuity: "+i);
                last=p;
            }
            if(Vector3.Distance(FootballPresentation.Entrance(i,0),FootballMotion.Position(i,0,false))>.001f)
                throw new InvalidOperationException("Entry does not end at kickoff: "+i);
            for(float t=0;t<=45;t+=.1f)
            {
                var p=FootballMotion.Position(i,t,true);
                if(Mathf.Abs(p.x)>52.5f||Mathf.Abs(p.z)>34)throw new InvalidOperationException("Player outside pitch");
            }
        }
        if(FootballPresentation.Stage(-15,"betting")!="walkout"||FootballPresentation.Stage(-9,"betting")!="lineup"||FootballPresentation.Stage(-3,"betting")!="taking-positions"||FootballPresentation.Stage(-.2f,"betting")!="kickoff"||FootballPresentation.Stage(0,"live")!="live")
            throw new InvalidOperationException("Football match phases are not synchronized");
        Vector3 previous=FootballMotion.Ball(0,true,out _,out _,out _);
        for(float t=.01f;t<=45;t+=.01f)
        {
            Vector3 p=FootballMotion.Ball(t,true,out _,out _,out _);
            if(!float.IsFinite(p.x)||!float.IsFinite(p.z)||p.y<.11f||Mathf.Abs(p.x)>52.5f||Mathf.Abs(p.z)>34||Vector3.Distance(previous,p)>.65f)
                throw new InvalidOperationException("Football pass discontinuity or bounds at "+t);
            previous=p;
        }
        for(int slot=1;slot<12;slot++)
        {
            float t=slot*FootballMotion.PossessionSeconds;
            var a=FootballMotion.Ball(t-.0001f,true,out _,out _,out _);var b=FootballMotion.Ball(t+.0001f,true,out _,out _,out _);
            if(Vector3.Distance(a,b)>.01f)throw new InvalidOperationException("First touch does not match receiving point: "+slot);
            float strike=FootballMotion.StrikeTime(t+FootballMotion.ContactSeconds,FootballMotion.Carrier(slot));
            if(Mathf.Abs(strike-.4f)>.0001f)throw new InvalidOperationException("Motion capture and ball contact are not synchronized");
        }
        Debug.Log("ARENA_FOOTBALL_CONTACT_PASS: continuous passes, receiving boundaries and captured strike contact at 0.4 seconds");
        Debug.Log("ARENA_FOOTBALL_PRESENTATION_PASS: 22 continuous entry paths, kickoff and field bounds, phase transitions");
    }
    static void CreateKitNumbers()
    {
        string[] glyphs={"01110100011001110101110011000101110","00100011000010000100001000010001110","01110100010000100010001000100011111","11110000010000101110000010000111110","00010001100101010010111110001000010","11111100001000011110000010000111110","01110100001000011110100011000101110","11111000010001000100010000100001000","01110100011000101110100011000101110","01110100011000101111000010000101110"};
        const int cell=128,size=512;
        var tex=new Texture2D(size,size,TextureFormat.RGBA32,true);
        var pixels=new Color[size*size];
        // Original club shield in the unused atlas cell; no licensed team mark.
        for(int y=16;y<112;y++)for(int x=25;x<103;x++)
        {
            float width=y<48?12+(y-16)*.85f:38;
            if(Mathf.Abs(x-64)>width)continue;
            bool edge=Mathf.Abs(x-64)>width-4||y>106||y<22;
            bool stripe=Mathf.Abs(x-64)<5&&y>37&&y<93;
            pixels[y*size+x]=edge||stripe?new Color(.97f,.98f,1):new Color(.08f,.12f,.19f);
        }
        for(int number=1;number<=11;number++)
        {
            string digits=number.ToString();int left=(number%4)*cell+(cell-digits.Length*36+6)/2,bottom=(number/4)*cell+30;
            for(int n=0;n<digits.Length;n++)for(int y=0;y<7;y++)for(int x=0;x<5;x++)if(glyphs[digits[n]-'0'][y*5+x]=='1')
                for(int dy=0;dy<6;dy++)for(int dx=0;dx<6;dx++)pixels[(bottom+(6-y)*7+dy)*size+left+n*36+x*6+dx]=new(.97f,.98f,1,1);
        }
        tex.SetPixels(pixels);tex.Apply();File.WriteAllBytes(ResourcesPath+"/KitNumbers.png",tex.EncodeToPNG());UnityEngine.Object.DestroyImmediate(tex);
        AssetDatabase.ImportAsset(ResourcesPath+"/KitNumbers.png");
        var importer=(TextureImporter)AssetImporter.GetAtPath(ResourcesPath+"/KitNumbers.png");importer.alphaIsTransparency=true;importer.mipmapEnabled=true;importer.SaveAndReimport();
        var mat=new Material(Shader.Find("Universal Render Pipeline/Lit"));mat.SetTexture("_BaseMap",AssetDatabase.LoadAssetAtPath<Texture2D>(ResourcesPath+"/KitNumbers.png"));
        mat.SetFloat("_AlphaClip",1);mat.SetFloat("_Cutoff",.35f);mat.EnableKeyword("_ALPHATEST_ON");mat.SetFloat("_Cull",0);mat.renderQueue=2450;
        Save(mat,ResourcesPath+"/KitNumbers.mat");
    }
    static void CreateSurfaceTextures()
    {
        var fabric=new Texture2D(128,128,TextureFormat.RGB24,false);
        for(int y=0;y<128;y++)for(int x=0;x<128;x++)
        {
            float shade=.84f+Mathf.PerlinNoise(x*.5f,y*.5f)*.12f+((x+y)%2)*.03f;
            fabric.SetPixel(x,y,new Color(shade,shade,shade));
        }
        fabric.Apply();File.WriteAllBytes(ResourcesPath+"/KitFabric.png",fabric.EncodeToPNG());UnityEngine.Object.DestroyImmediate(fabric);
        AssetDatabase.ImportAsset(ResourcesPath+"/KitFabric.png");
        CreateLED();
        const int size=1024;
        foreach(bool maple in new[]{true,false})
        {
            var texture=new Texture2D(size,size,TextureFormat.RGB24,false);
            var pixels=new Color[size*size];
            for(int y=0;y<size;y++)for(int x=0;x<size;x++)
            {
                float noise=Mathf.PerlinNoise(x*.13f,y*.13f);
                if(maple)
                {
                    int plank=y/64;int joint=(x+plank*137)%512;
                    float variation=Mathf.PerlinNoise(plank*3.31f,Mathf.Floor((x+plank*137)/512f)*4.17f);
                    float grain=Mathf.PerlinNoise(x*.006f,y*.21f)*.10f+noise*.025f;
                    float shade=.78f+variation*.16f+grain;
                    if(y%64<2||joint<2)shade*=.61f;
                    pixels[y*size+x]=new Color(.78f,.59f,.34f)*shade;
                }
                else
                {
                    float wear=Mathf.PerlinNoise(x*.012f,y*.018f);
                    float shade=.76f+noise*.14f+wear*.17f;
                    pixels[y*size+x]=new Color(.65f,.52f,.34f)*shade;
                }
            }
            texture.SetPixels(pixels);texture.Apply();
            string path=ResourcesPath+(maple?"/MapleSurface.png":"/WicketSurface.png");
            File.WriteAllBytes(path,texture.EncodeToPNG());UnityEngine.Object.DestroyImmediate(texture);
            AssetDatabase.ImportAsset(path);
            var importer=(TextureImporter)AssetImporter.GetAtPath(path);
            importer.mipmapEnabled=true;importer.anisoLevel=8;importer.wrapMode=TextureWrapMode.Repeat;importer.SaveAndReimport();
        }
    }
    static void CreateCricketWicket()
    {
        const int width=1536,height=256;
        var texture=new Texture2D(width,height,TextureFormat.RGB24,false);
        var pixels=new Color[width*height];
        for(int y=0;y<height;y++)for(int x=0;x<width;x++)
        {
            float grain=Mathf.PerlinNoise(x*.48f,y*.48f);
            float earth=Mathf.PerlinNoise(x*.023f,y*.031f);
            float end=Mathf.Exp(-Mathf.Pow((x-172)/125f,2))+Mathf.Exp(-Mathf.Pow((x-1364)/125f,2));
            float scuff=end*Mathf.PerlinNoise(x*.081f,y*.10f)*.17f;
            float crack=Mathf.Abs(Mathf.Sin(y*.17f+Mathf.PerlinNoise(x*.012f,y*.02f)*19));
            float shade=.81f+grain*.15f+earth*.11f-scuff;
            if(crack<.022f&&earth>.49f)shade*=.77f;
            pixels[y*width+x]=new Color(.65f,.57f,.40f)*shade;
        }
        texture.SetPixels(pixels);texture.Apply();
        string path=ResourcesPath+"/CricketWicket.png";
        File.WriteAllBytes(path,texture.EncodeToPNG());UnityEngine.Object.DestroyImmediate(texture);
        AssetDatabase.ImportAsset(path);
        var importer=(TextureImporter)AssetImporter.GetAtPath(path);
        importer.mipmapEnabled=true;importer.anisoLevel=8;importer.wrapMode=TextureWrapMode.Clamp;importer.maxTextureSize=2048;importer.SaveAndReimport();
    }
    static void CreateLED()
    {
        var glyphs=new System.Collections.Generic.Dictionary<char,string>{
            ['A']="01110100011000111111100011000110001",['R']="11110100011000111110101001001010001",
            ['E']="11111100001000011110100001000011111",['N']="10001110011010110011100011000110001",
            ['S']="01111100001000001110000010000111110",['P']="11110100011000111110100001000010000",
            ['O']="01110100011000110001100011000101110",['T']="11111001000010000100001000010000100",
            ['L']="10000100001000010000100001000011111",['I']="11111001000010000100001000010011111",
            ['V']="10001100011000110001100010101000100"};
        const string text="ARENA SPORTS  LIVE";
        const int width=512,height=64;
        var tex=new Texture2D(width,height,TextureFormat.RGB24,false);
        var pixels=new Color[width*height];for(int i=0;i<pixels.Length;i++)pixels[i]=new(.015f,.065f,.074f);
        int start=(width-text.Length*24)/2;
        for(int c=0;c<text.Length;c++)if(glyphs.TryGetValue(text[c],out string glyph))
            for(int y=0;y<7;y++)for(int x=0;x<5;x++)if(glyph[y*5+x]=='1')
                for(int dy=0;dy<3;dy++)for(int dx=0;dx<3;dx++)pixels[(45-y*4+dy)*width+start+c*24+x*4+dx]=new(.74f,.96f,.84f);
        tex.SetPixels(pixels);tex.Apply();File.WriteAllBytes(ResourcesPath+"/ArenaLED.png",tex.EncodeToPNG());UnityEngine.Object.DestroyImmediate(tex);
        AssetDatabase.ImportAsset(ResourcesPath+"/ArenaLED.png");
        var mat=new Material(Shader.Find("Universal Render Pipeline/Unlit"));mat.SetTexture("_BaseMap",AssetDatabase.LoadAssetAtPath<Texture2D>(ResourcesPath+"/ArenaLED.png"));
        Save(mat,ResourcesPath+"/ArenaLED.mat");
    }
    static void CreatePrimitives()
    {
        Directory.CreateDirectory(ResourcesPath+"/Primitives");AssetDatabase.Refresh();
        foreach(var type in new[]{PrimitiveType.Cube,PrimitiveType.Sphere,PrimitiveType.Cylinder,PrimitiveType.Plane})
        {
            var temporary=GameObject.CreatePrimitive(type);
            var mesh=UnityEngine.Object.Instantiate(temporary.GetComponent<MeshFilter>().sharedMesh);
            mesh.name=type.ToString();Save(mesh,ResourcesPath+"/Primitives/"+type+".asset");
            UnityEngine.Object.DestroyImmediate(temporary);
        }
    }
    static void ImportAthletes()
    {
        foreach(string model in new[]{"FootballPlayer","CricketPlayer"})
        {
            bool football=model=="FootballPlayer";
            var source=JsonUtility.FromJson<MaterialList>(File.ReadAllText(ResourcesPath+"/Sports/"+(football?"football-materials.json":"materials.json")));
            string path=ResourcesPath+"/Sports/"+model+".fbx";
            var importer=AssetImporter.GetAtPath(path) as ModelImporter;
            importer.animationType=ModelImporterAnimationType.Generic;
            importer.avatarSetup=ModelImporterAvatarSetup.CreateFromThisModel;
            importer.importAnimation=true;importer.importCameras=false;importer.importLights=false;
            importer.isReadable=false;importer.meshCompression=ModelImporterMeshCompression.Low;
            importer.optimizeMeshPolygons=true;importer.optimizeMeshVertices=true;
            foreach(var remap in importer.GetExternalObjectMap())
                if(!source.materials.Any(entry=>entry.name==remap.Key.name))importer.RemoveRemap(remap.Key);
            foreach(var entry in source.materials)
                importer.AddRemap(new AssetImporter.SourceAssetIdentifier(typeof(Material),entry.name),
                    AssetDatabase.LoadAssetAtPath<Material>(ResourcesPath+"/Sports/Materials/"+(football?"Football_":"")+SafeName(entry.name)+".mat"));
            var clips=importer.defaultClipAnimations;
            foreach(var clip in clips)
            {
                clip.loopTime=!clip.name.EndsWith("Kick")&&!clip.name.EndsWith("Pass")&&!clip.name.EndsWith("Celebrate");
                clip.loopPose=clip.loopTime;clip.lockRootRotation=true;clip.lockRootPositionXZ=true;clip.lockRootHeightY=true;
            }
            importer.clipAnimations=clips;importer.SaveAndReimport();
            var human=AssetDatabase.LoadAssetAtPath<GameObject>(path);
            var meshes=human.GetComponentsInChildren<SkinnedMeshRenderer>();
            if(meshes.Length!=3||meshes.Any(r=>r.sharedMaterials.Length!=(football?4:3)))
                throw new InvalidOperationException(model+" has an unexpected LOD/material layout.");
            Debug.Log("ARENA_HUMAN_LODS "+model+": "+string.Join(",",meshes.Select(r=>r.name+"="+r.sharedMesh.vertexCount)));
            var animations=AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().Where(a=>!a.name.StartsWith("__preview__")).ToArray();
            if(animations.Length<6)throw new InvalidOperationException(model+" requires six imported animation clips; found "+animations.Length);
            Debug.Log("ARENA_ANIMATIONS "+model+": "+string.Join(",",animations.Select(a=>a.name)));
            if(football)
            {
                if(!animations.Any(a=>a.name.EndsWith("Kick")))throw new InvalidOperationException("Shared character must retain the generic Kick clip for other sports.");
                var preview=(GameObject)PrefabUtility.InstantiatePrefab(human);
                try
                {
                    var pass=animations.Single(a=>a.name.EndsWith("Pass"));
                    pass.SampleAnimation(preview,.4f);
                    var toe=preview.GetComponentsInChildren<Transform>().Single(t=>t.name=="Toe.R");
                    Debug.Log("ARENA_CAPTURE_CONTACT: toe="+toe.position+", ball="+FootballMotion.StrikeOffset);
                    if(Vector3.Distance(toe.position,FootballMotion.StrikeOffset)>.30f)
                        throw new InvalidOperationException("Football strike does not reach the ball at contact: "+toe.position);
                }
                finally{UnityEngine.Object.DestroyImmediate(preview);}
            }
        }
    }
    static void CreatePostProcessing()
    {
        var profile=ScriptableObject.CreateInstance<VolumeProfile>();
        profile=Save(profile,ResourcesPath+"/ArenaPost.asset");
        // Components are sub-assets, so WebGL preserves them during stripping.
        foreach(var old in AssetDatabase.LoadAllAssetsAtPath(ResourcesPath+"/ArenaPost.asset"))
            if(old is VolumeComponent)UnityEngine.Object.DestroyImmediate(old,true);
        profile.components.Clear();
        var tone=profile.Add<Tonemapping>(true);tone.mode.Override(TonemappingMode.ACES);
        var grading=profile.Add<ColorAdjustments>(true);grading.postExposure.Override(.25f);grading.contrast.Override(9);grading.saturation.Override(-5);
        // Keep ACES/colour grading in one pass; omit the full-resolution bloom chain.
        var vignette=profile.Add<Vignette>(true);vignette.intensity.Override(.12f);vignette.smoothness.Override(.5f);
        foreach(var component in profile.components)AssetDatabase.AddObjectToAsset(component,profile);
        EditorUtility.SetDirty(profile);
    }
    static void CreateBall(Shader shader)
    {
        // A procedural football panel texture; no downloaded branding.
        var tex=new Texture2D(512,256,TextureFormat.RGB24,false);
        var poles=new System.Collections.Generic.List<Vector3>{Vector3.up,Vector3.down};
        for(int row=0;row<2;row++)for(int i=0;i<5;i++)
        {
            float a=(i+(row==0?0:.5f))*Mathf.PI*2/5;
            poles.Add(new Vector3(Mathf.Cos(a)*.894f,row==0?.447f:-.447f,Mathf.Sin(a)*.894f));
        }
        var pixels=new Color[512*256];
        for(int y=0;y<256;y++)for(int x=0;x<512;x++)
        {
            float latitude=(y/255f-.5f)*Mathf.PI,longitude=x/511f*Mathf.PI*2;
            Vector3 p=new(Mathf.Cos(latitude)*Mathf.Cos(longitude),Mathf.Sin(latitude),Mathf.Cos(latitude)*Mathf.Sin(longitude));
            float nearest=poles.Max(n=>Vector3.Dot(n,p));
            pixels[y*512+x]=nearest>.947f?new(.035f,.045f,.055f):nearest>.94f?new(.4f,.42f,.4f):new(.88f,.89f,.83f);
        }
        tex.SetPixels(pixels);tex.Apply();File.WriteAllBytes(ResourcesPath+"/FootballPanels.png",tex.EncodeToPNG());
        UnityEngine.Object.DestroyImmediate(tex);AssetDatabase.ImportAsset(ResourcesPath+"/FootballPanels.png");
        var mat=new Material(shader);mat.SetTexture("_BaseMap",AssetDatabase.LoadAssetAtPath<Texture2D>(ResourcesPath+"/FootballPanels.png"));
        mat.SetFloat("_Smoothness",.27f);Save(mat,ResourcesPath+"/FootballBall.mat");
    }
    [MenuItem("Arena Sports/Build website WebGL")]
    public static void WebGL()
    {
        Prepare();
        string output=Environment.GetEnvironmentVariable("ARENA_WEBGL_OUTPUT");
        if(string.IsNullOrEmpty(output))output=Path.GetFullPath("Builds/WebGL");
        var report=BuildPipeline.BuildPlayer(new BuildPlayerOptions {
            scenes=new[]{"Assets/Scenes/Arena.unity"},locationPathName=output,target=BuildTarget.WebGL,
            options=BuildOptions.None
        });
        if(report.summary.result!=BuildResult.Succeeded)throw new InvalidOperationException("Unity WebGL failed: "+report.summary.result);
        File.WriteAllText(Path.Combine(output,"ready.json"),"{\"engine\":\"unity\",\"version\":\"6000.5.9f1\",\"sports\":[\"football\",\"cricket\",\"basketball\",\"tennis\",\"formula\"]}");
        Debug.Log("ARENA_WEBGL_SUCCESS: "+output+" ("+report.summary.totalSize+" bytes)");
    }
}

public sealed class ArenaTextureImporter : AssetPostprocessor
{
    void OnPreprocessTexture()
    {
        if(!assetPath.Contains("Resources/Sports/Textures/"))return;
        var importer=(TextureImporter)assetImporter;
        importer.maxTextureSize=2048;importer.mipmapEnabled=true;importer.anisoLevel=4;
        importer.textureCompression=TextureImporterCompression.Compressed;
        if(assetPath.Contains("normal")) {importer.textureType=TextureImporterType.NormalMap;importer.sRGBTexture=false;}
        if(assetPath.EndsWith("football-fans.png")) {importer.alphaIsTransparency=true;importer.wrapMode=TextureWrapMode.Clamp;}
    }
}
