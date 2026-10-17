using System;
using System.IO;
using System.Linq;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.Universal;

public static class HorseBuild
{
    const string R = "Assets/Resources/";
    [Serializable] class Source { public string name, model, albedo, normal, roughness; public float[] color; }
    [Serializable] class Sources { public Source[] materials; }
    static T Save<T>(T asset, string path) where T : UnityEngine.Object
    {
        var old = AssetDatabase.LoadAssetAtPath<T>(path);
        if (old) { EditorUtility.CopySerialized(asset, old); UnityEngine.Object.DestroyImmediate(asset); return old; }
        AssetDatabase.CreateAsset(asset, path); return asset;
    }
    static string Safe(string s) => string.Concat(s.Select(c => char.IsLetterOrDigit(c) ? c : '_'));
    static Texture2D RequiredTexture(string file)
    {
        var texture=AssetDatabase.LoadAssetAtPath<Texture2D>(R+"Horse/Textures/"+file);
        if(!texture)throw new Exception("Horse texture failed to import: "+file);
        return texture;
    }
    [MenuItem("Horse Racing/Prepare stadium")]
    public static void Prepare()
    {
        foreach (var dir in new[] { "Assets/Scenes", "Assets/Settings", R + "Primitives", R + "Horse/Materials", R + "Horse/Clips" }) Directory.CreateDirectory(dir);
        AssetDatabase.Refresh();
        // Existing foliage imports predate coverage-preserving mipmaps. Apply
        // this to the actual textures too, so distant trees retain their leaves.
        foreach(var guid in AssetDatabase.FindAssets("Tree_ t:Texture2D",new[]{R+"Horse/Textures"}))
        {
            var path=AssetDatabase.GUIDToAssetPath(guid);
            if(!path.Contains("_albedo")||(!path.Contains("leaves")&&!path.Contains("branches")))continue;
            var t=(TextureImporter)AssetImporter.GetAtPath(path);
            if(t.mipMapsPreserveCoverage&&t.alphaIsTransparency)continue;
            t.mipMapsPreserveCoverage=true;t.alphaTestReferenceValue=.35f;t.alphaIsTransparency=true;t.SaveAndReimport();
        }
        var renderer = Save(ScriptableObject.CreateInstance<UniversalRendererData>(), "Assets/Settings/HorseRenderer.asset");
        renderer.postProcessData = AssetDatabase.LoadAssetAtPath<PostProcessData>("Packages/com.unity.render-pipelines.universal/Runtime/Data/PostProcessData.asset");
        foreach(var old in AssetDatabase.LoadAllAssetsAtPath("Assets/Settings/HorseRenderer.asset"))
            if(old is ScriptableRendererFeature) UnityEngine.Object.DestroyImmediate(old,true);
        renderer.rendererFeatures.Clear();
        var occlusion=ScriptableObject.CreateInstance<ScreenSpaceAmbientOcclusion>();occlusion.name="Stadium contact shading";
        var ao=new SerializedObject(occlusion);var settings=ao.FindProperty("m_Settings");
        settings.FindPropertyRelative("AOMethod").enumValueIndex=1;
        settings.FindPropertyRelative("Downsample").boolValue=true;
        settings.FindPropertyRelative("AfterOpaque").boolValue=true;
        settings.FindPropertyRelative("Source").enumValueIndex=0;
        settings.FindPropertyRelative("Intensity").floatValue=.72f;
        settings.FindPropertyRelative("Radius").floatValue=.34f;
        settings.FindPropertyRelative("Falloff").floatValue=150;
        ao.ApplyModifiedPropertiesWithoutUndo();
        // Contact shadows come from the horse shadow map. SSAO adds a full
        // depth prepass to every crowd member and is too costly on laptop GPUs.
        UnityEngine.Object.DestroyImmediate(occlusion);
        EditorUtility.SetDirty(renderer);
        var pipeline = UniversalRenderPipelineAsset.Create(renderer);
        pipeline.supportsHDR = true; pipeline.msaaSampleCount = 1; pipeline.renderScale = 1;
        pipeline.shadowDistance = 85; pipeline.shadowCascadeCount = 1; pipeline.mainLightShadowmapResolution = 2048;
        pipeline.maxAdditionalLightsCount=2;
        pipeline.supportsCameraDepthTexture = false;
        var serialized = new SerializedObject(pipeline);
        serialized.FindProperty("m_AdditionalLightsRenderingMode").intValue=(int)LightRenderingMode.PerVertex;
        serialized.FindProperty("m_MainLightShadowsSupported").boolValue = true;
        serialized.FindProperty("m_SoftShadowsSupported").boolValue = true;
        serialized.ApplyModifiedPropertiesWithoutUndo();
        pipeline = Save(pipeline, "Assets/Settings/HorsePipeline.asset");
        GraphicsSettings.defaultRenderPipeline = pipeline; QualitySettings.renderPipeline = pipeline;
        if (!GraphicsSettings.GetSettingsForRenderPipeline<UniversalRenderPipeline>())
        {
            var type = typeof(UniversalRenderPipelineAsset).Assembly.GetType("UnityEngine.Rendering.Universal.UniversalRenderPipelineGlobalSettings", true);
            var global = RenderPipelineGlobalSettingsUtils.Create(type, "Assets/Settings/HorseGlobal.asset");
            UnityEditor.Rendering.EditorGraphicsSettings.SetRenderPipelineGlobalSettingsAsset<UniversalRenderPipeline>(global);
        }
        var lit = new Material(Shader.Find("Universal Render Pipeline/Lit")); lit.SetFloat("_Smoothness", .2f);
        lit.EnableKeyword("_EMISSION"); lit.SetColor("_EmissionColor", Color.black);
        Save(lit, R + "ArenaLit.mat");
        Save(new Material(Shader.Find("Universal Render Pipeline/Unlit")), R + "HorseUnlit.mat");
        Save(new Material(Shader.Find("WorldRacing/DepthText")), R + "HorseText.mat");
        Save(new Material(Shader.Find("WorldRacing/HoofDust")), R + "HorseDust.mat");
        var crowd = new Material(Shader.Find("Universal Render Pipeline/Unlit"));
        crowd.SetTexture("_BaseMap", AssetDatabase.LoadAssetAtPath<Texture2D>(R + "Horse/Textures/spectators.png"));
        crowd.SetFloat("_AlphaClip", 1); crowd.SetFloat("_Cutoff", .36f); crowd.SetFloat("_Cull", 0);
        crowd.EnableKeyword("_ALPHATEST_ON"); crowd.renderQueue = 2450; Save(crowd, R + "HorseCrowd.mat");
        var sky = new Material(Shader.Find("Skybox/Panoramic"));
        sky.SetTexture("_MainTex", AssetDatabase.LoadAssetAtPath<Texture2D>(R + "Horse/Textures/daylight.hdr"));
        sky.SetFloat("_Exposure", .65f); Save(sky, R + "HorseSky.mat");
        foreach (var type in new[] { PrimitiveType.Cube, PrimitiveType.Sphere, PrimitiveType.Cylinder, PrimitiveType.Plane, PrimitiveType.Quad })
        {
            var go = GameObject.CreatePrimitive(type);
            Save(UnityEngine.Object.Instantiate(go.GetComponent<MeshFilter>().sharedMesh), R + "Primitives/" + type + ".asset");
            UnityEngine.Object.DestroyImmediate(go);
        }
        var sources = JsonUtility.FromJson<Sources>(File.ReadAllText(R + "Horse/materials.json"));
        foreach (var entry in sources.materials)
        {
            var mat = new Material(Shader.Find(entry.model == "Thoroughbred" ? "WorldRacing/ThoroughbredCoat" : "Universal Render Pipeline/Lit")) { name = entry.name };
            var c = entry.color;
            mat.SetColor("_BaseColor", string.IsNullOrEmpty(entry.albedo) ? new Color(c[0], c[1], c[2], c[3]) : Color.white);
            mat.SetFloat("_Smoothness", entry.name.Contains("Boot") ? .35f : .22f);
            if (!string.IsNullOrEmpty(entry.albedo)) mat.SetTexture("_BaseMap", RequiredTexture(entry.albedo));
            if (!string.IsNullOrEmpty(entry.roughness)) mat.SetTexture("_MetallicGlossMap", RequiredTexture(entry.roughness));
            if (!string.IsNullOrEmpty(entry.normal))
            {
                mat.SetTexture("_BumpMap", RequiredTexture(entry.normal));
                mat.SetFloat("_BumpScale", .6f); mat.EnableKeyword("_NORMALMAP");
            }
            mat.enableInstancing=entry.model.StartsWith("Spectator")||entry.model=="Tree";
            if (entry.name == "Material.003" || entry.name.Contains("Hair") || entry.name.Contains("Mane") || entry.name.Contains("Tail") || entry.name.Contains("Lash") || entry.name.Contains("leaves") || entry.name.Contains("branches"))
            { mat.SetFloat("_AlphaClip", 1); mat.SetFloat("_Cutoff", .35f); mat.SetFloat("_Cull", 0); mat.EnableKeyword("_ALPHATEST_ON"); mat.renderQueue = 2450; }
            Save(mat, R + "Horse/Materials/" + entry.model + "_" + Safe(entry.name) + ".mat");
        }
        foreach (var model in new[] { "Thoroughbred", "Jockey", "Spectator", "SpectatorFar", "Tree" })
        {
            string path = R + "Horse/" + model + ".fbx";
            var importer = (ModelImporter)AssetImporter.GetAtPath(path);
            importer.animationType = ModelImporterAnimationType.Generic;
            importer.importAnimation = model == "Thoroughbred"; importer.importCameras = false; importer.importLights = false;
            importer.isReadable = false; importer.meshCompression = ModelImporterMeshCompression.Off;
            foreach (var entry in sources.materials.Where(e => e.model == model))
                importer.AddRemap(new AssetImporter.SourceAssetIdentifier(typeof(Material), entry.name), AssetDatabase.LoadAssetAtPath<Material>(R + "Horse/Materials/" + entry.model + "_" + Safe(entry.name) + ".mat"));
            var clips = importer.defaultClipAnimations;
            foreach (var clip in clips) { clip.loopTime = true; clip.loopPose = true; clip.lockRootRotation = true; clip.lockRootPositionXZ = true; }
            importer.clipAnimations = clips; importer.SaveAndReimport();
            foreach (var clip in AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().Where(c => !c.name.StartsWith("__preview__")))
            {
                string name = clip.name.Contains("Gallop") ? "Gallop" : clip.name.Contains("Idle") ? "Idle" : Safe(clip.name);
                Save(UnityEngine.Object.Instantiate(clip), R + "Horse/Clips/" + name + ".anim");
            }
        }
        if (!AssetDatabase.LoadAssetAtPath<AnimationClip>(R + "Horse/Clips/Gallop.anim")) throw new Exception("Horse Gallop animation missing");
        foreach(string person in new[]{"Eric","Carla","Claudia"})
        {
            var skin=new Material(Shader.Find("Universal Render Pipeline/Lit"));skin.enableInstancing=true;
            skin.SetTexture("_BaseMap",AssetDatabase.LoadAssetAtPath<Texture2D>(R+"Horse/Crowd/"+person+"-color.png"));skin.SetFloat("_Smoothness",.12f);
            Save(skin,R+"Horse/Crowd/"+person+".mat");
            var card=new Material(Shader.Find("Universal Render Pipeline/Unlit"));card.enableInstancing=true;
            card.SetTexture("_BaseMap",AssetDatabase.LoadAssetAtPath<Texture2D>(R+"Horse/Crowd/"+person+"-card.png"));
            card.SetFloat("_AlphaClip",1);card.SetFloat("_Cutoff",.4f);card.SetFloat("_Cull",0);card.EnableKeyword("_ALPHATEST_ON");card.renderQueue=2450;
            Save(card,R+"Horse/Crowd/"+person+"Card.mat");
        }
        var faceMaterial=new Material(Shader.Find("Universal Render Pipeline/Lit"));
        faceMaterial.SetTexture("_BaseMap",RequiredTexture("Jockey-scanned-face.png"));faceMaterial.SetFloat("_Smoothness",.2f);
        faceMaterial=Save(faceMaterial,R+"Horse/Materials/Jockey_ScannedFace.mat");
        var jockeyImporter=(ModelImporter)AssetImporter.GetAtPath(R+"Horse/JockeyScan.fbx");
        jockeyImporter.importAnimation=false;jockeyImporter.importCameras=false;jockeyImporter.importLights=false;
        jockeyImporter.isReadable=true; // Runtime combines the static rider by material.
        jockeyImporter.AddRemap(new AssetImporter.SourceAssetIdentifier(typeof(Material),"ScannedJockeyFace"),faceMaterial);
        foreach(var entry in sources.materials.Where(e=>e.model=="Jockey"))
            jockeyImporter.AddRemap(new AssetImporter.SourceAssetIdentifier(typeof(Material),entry.name),AssetDatabase.LoadAssetAtPath<Material>(R+"Horse/Materials/Jockey_"+Safe(entry.name)+".mat"));
        jockeyImporter.SaveAndReimport();
        var profile = Save(ScriptableObject.CreateInstance<VolumeProfile>(), R + "HorsePost.asset");
        foreach (var old in AssetDatabase.LoadAllAssetsAtPath(R + "HorsePost.asset")) if (old is VolumeComponent) UnityEngine.Object.DestroyImmediate(old, true);
        profile.components.Clear();
        profile.Add<Tonemapping>(true).mode.Override(TonemappingMode.ACES);
        var color = profile.Add<ColorAdjustments>(true); color.postExposure.Override(.3f); color.contrast.Override(3); color.saturation.Override(-3);
        var bloom = profile.Add<Bloom>(true); bloom.intensity.Override(.13f); bloom.threshold.Override(1.4f);
        var vignette=profile.Add<Vignette>(true);vignette.intensity.Override(.13f);vignette.smoothness.Override(.65f);
        foreach (var component in profile.components) AssetDatabase.AddObjectToAsset(component, profile);
        EditorUtility.SetDirty(profile);
        var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
        new GameObject("HorseBridge").AddComponent<HorseRacing.HorseBridge>();
        RenderSettings.skybox = sky;
        EditorSceneManager.SaveScene(scene, "Assets/Scenes/HorseRace.unity");
        EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene("Assets/Scenes/HorseRace.unity", true) };
        PlayerSettings.companyName = "World Racing"; PlayerSettings.productName = "Royal Park Horse Racing";
        PlayerSettings.colorSpace = ColorSpace.Linear; PlayerSettings.runInBackground = true;
        PlayerSettings.SetScriptingBackend(NamedBuildTarget.WebGL, ScriptingImplementation.IL2CPP);
        PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, ManagedStrippingLevel.Minimal);
        PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
        PlayerSettings.WebGL.initialMemorySize = 256; PlayerSettings.WebGL.maximumMemorySize = 1024;
        PlayerSettings.WebGL.memoryGrowthMode = WebGLMemoryGrowthMode.Geometric;
        PlayerSettings.WebGL.template = "PROJECT:Horse"; PlayerSettings.WebGL.dataCaching = true;
        QualitySettings.skinWeights = SkinWeights.FourBones;
        AssetDatabase.SaveAssets(); Debug.Log("HORSE_PREPARED");
    }
    [MenuItem("Horse Racing/Build WebGL")]
    public static void WebGL()
    {
        Prepare();
        var output = Path.GetFullPath("Builds/WebGL");
        var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions { scenes = new[] { "Assets/Scenes/HorseRace.unity" }, locationPathName = output, target = BuildTarget.WebGL });
        if (report.summary.result != BuildResult.Succeeded) throw new Exception("Horse WebGL build failed: " + report.summary.result);
        File.WriteAllText(Path.Combine(output, "ready.json"), "{\"engine\":\"unity-urp\",\"version\":1,\"visualRevision\":4,\"runners\":8,\"horse\":\"grab3d-bay-56-bone\",\"crowd\":\"scanned-mesh-impostor-lod\"}");
        Debug.Log("HORSE_WEBGL_SUCCESS " + report.summary.totalSize);
    }
}
public sealed class HorseTextureImporter : AssetPostprocessor
{
    void OnPreprocessTexture()
    {
        if (!assetPath.Contains("Horse/Textures/")&&!assetPath.Contains("Horse/Crowd/")) return;
        var t = (TextureImporter)assetImporter; t.maxTextureSize = 2048; t.mipmapEnabled = true; t.anisoLevel = 8;
        if (assetPath.Contains("normal")) { t.textureType = TextureImporterType.NormalMap; t.sRGBTexture = false; }
        if (assetPath.Contains("roughness")) t.sRGBTexture=false;
        if(assetPath.Contains("BayHorse-albedo"))t.maxTextureSize=4096;
        if (assetPath.Contains("spectators")) { t.alphaIsTransparency = true; t.wrapMode = TextureWrapMode.Clamp; }
        if(assetPath.Contains("-card")){t.alphaIsTransparency=true;t.wrapMode=TextureWrapMode.Clamp;t.maxTextureSize=512;}
        if(assetPath.Contains("leaves")||assetPath.Contains("branches")||assetPath.Contains("-card"))
        {t.mipMapsPreserveCoverage=true;t.alphaTestReferenceValue=.35f;if(assetPath.Contains("_albedo"))t.alphaIsTransparency=true;}
    }
}
