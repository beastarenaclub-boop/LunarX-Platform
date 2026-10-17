Shader "WorldRacing/HoofDust"
{
    Properties { _BaseColor("Loam tint",Color)=(.42,.30,.19,.3) }
    SubShader
    {
        Tags { "RenderPipeline"="UniversalPipeline" "RenderType"="Transparent" "Queue"="Transparent" }
        Pass
        {
            Tags { "LightMode"="UniversalForward" }
            Blend SrcAlpha OneMinusSrcAlpha
            ZWrite Off
            Cull Off
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            struct Attributes { float4 positionOS:POSITION;float2 uv:TEXCOORD0;half4 color:COLOR; };
            struct Varyings { float4 positionCS:SV_POSITION;float2 uv:TEXCOORD0;half4 color:COLOR; };
            CBUFFER_START(UnityPerMaterial)
            half4 _BaseColor;
            CBUFFER_END
            Varyings vert(Attributes input) { Varyings o;o.positionCS=TransformObjectToHClip(input.positionOS.xyz);o.uv=input.uv;o.color=input.color;return o; }
            half4 frag(Varyings i):SV_Target
            {
                float2 p=i.uv*2-1;float radial=saturate(1-dot(p,p));
                float noise=.72+.28*sin(p.x*13+p.y*9)*sin(p.y*18-p.x*7);
                return half4(_BaseColor.rgb,i.color.a*_BaseColor.a*radial*radial*noise);
            }
            ENDHLSL
        }
    }
}
