Shader "WorldRacing/ThoroughbredCoat"
{
    Properties
    {
        [MainTexture] _BaseMap("Coat detail",2D)="white" {}
        [MainColor] _BaseColor("Individual coat",Color)=(1,1,1,1)
        _CoatSaturation("Coat saturation",Range(0,1))=1
        _MetallicGlossMap("PBR roughness (green)",2D)="gray" {}
        [Normal] _BumpMap("Anatomical normal",2D)="bump" {}
        _BumpScale("Normal strength",Float)=.6
        _Smoothness("Smoothness",Range(0,1))=.28
        _Metallic("Metallic",Range(0,1))=0
        _SpecColor("Specular",Color)=(.2,.2,.2,1)
        _OcclusionStrength("Occlusion",Float)=1
        _Cutoff("Cutoff",Float)=.5
        _Cull("Cull",Float)=2
        _Surface("Surface",Float)=0
        _EmissionColor("Emission",Color)=(0,0,0,1)
    }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Opaque" "UniversalMaterialType"="Lit" }
        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode"="UniversalForward" }
            ZWrite On
            Cull Back
            HLSLPROGRAM
            #pragma target 3.0
            #pragma vertex LitPassVertex
            #pragma fragment LitPassFragment
            #pragma shader_feature_local _NORMALMAP
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS _MAIN_LIGHT_SHADOWS_CASCADE _MAIN_LIGHT_SHADOWS_SCREEN
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX _ADDITIONAL_LIGHTS
            #pragma multi_compile_fragment _ _SHADOWS_SOFT _SHADOWS_SOFT_LOW _SHADOWS_SOFT_MEDIUM _SHADOWS_SOFT_HIGH
            #pragma multi_compile _ EVALUATE_SH_MIXED EVALUATE_SH_VERTEX
            #pragma multi_compile_instancing
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Fog.hlsl"
            #include_with_pragmas "Packages/com.unity.render-pipelines.universal/ShaderLibrary/ProbeVolumeVariants.hlsl"
            #define InitializeStandardLitSurfaceData InitializeOriginalCoatSurface
            #include "Packages/com.unity.render-pipelines.universal/Shaders/LitInput.hlsl"
            #undef InitializeStandardLitSurfaceData
            half _CoatSaturation;
            void InitializeStandardLitSurfaceData(float2 uv,out SurfaceData surface)
            {
                InitializeOriginalCoatSurface(uv,surface);
                half3 detailMap=SampleAlbedoAlpha(uv,TEXTURE2D_ARGS(_BaseMap,sampler_BaseMap)).rgb;
                half luminance=dot(detailMap,half3(.2126,.7152,.0722));
                surface.albedo=saturate(lerp(luminance.xxx,detailMap,_CoatSaturation)*_BaseColor.rgb);
                half roughness=SAMPLE_TEXTURE2D(_MetallicGlossMap,sampler_MetallicGlossMap,uv).g;
                surface.smoothness=clamp(1-roughness,.12,.42);
            }
            #include "Packages/com.unity.render-pipelines.universal/Shaders/LitForwardPass.hlsl"
            ENDHLSL
        }
        UsePass "Universal Render Pipeline/Lit/ShadowCaster"
        UsePass "Universal Render Pipeline/Lit/DepthOnly"
        UsePass "Universal Render Pipeline/Lit/DepthNormals"
    }
}
