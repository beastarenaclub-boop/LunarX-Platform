// Fitted to measured slices of the CC0 Grab3D mesh, in glTF metres (+Z forward).
import { RigSession } from '../../.cache/horse-v4/rig-tools/node_modules/afk-rig/dist/index.js';
import { writeFileSync } from 'node:fs';
const rig=await RigSession.open('.cache/horse-v4/horse-game.afk-rig.json');
rig.set_joints({
  root:[0,0,0], hips:[0,1.28,-.66], spine_1:[0,1.25,-.39],
  spine_2:[0,1.24,-.08],spine_3:[0,1.30,.22],spine_4:[0,1.41,.40],
  spine_5:[0,1.58,.59],spine_6:[0,1.74,.77],head:[0,1.79,.91],
  nose:[0,1.53,1.12],head_leaf:[0,1.45,1.18],mouth:[0,1.48,1.09],mouth_tip:[0,1.43,1.14],
  ribcage_middle:[0,1.08,-.02],ribcage_leaf:[0,.86,-.02],
  ribcage_front:[0,1.10,.39],ribcage_front_leaf:[0,1.02,.43],
  tail_1:[0,1.32,-.97],tail_2:[0,1.12,-1.075],tail_3:[0,.85,-1.09],
  tail_4:[0,.58,-1.10],tail_leaf:[0,.30,-1.10],
  ear_1_l:[.073,1.88,.92],ear_2_l:[.08,1.935,.94],ear_leaf_l:[.085,1.995,.95],
  front_scapula_l:[.13,1.37,.35],front_humerus_l:[.19,1.11,.43],
  front_leg_upper_l:[.16,.93,.30],front_leg_lower_l:[.13,.52,.294],
  front_leg_ankle_l:[.14,.19,.25],front_leg_foot_l:[.14,.085,.30],front_leg_leaf_l:[.14,.025,.335],
  back_leg_pelvis_l:[.13,1.31,-.65],back_leg_upper_l:[.20,1.10,-.78],
  back_leg_lower_l:[.19,.90,-.69],back_leg_ankle_l:[.14,.53,-.90],
  back_leg_foot_l:[.15,.18,-.925],back_leg_toe_l:[.15,.07,-.89],back_leg_leaf_l:[.15,.025,-.86]
},{mirror:true,mirror_x:0});
rig.set_weight_rules({clear:true,add:[
  {mode:'only',bones:['tail_1*'],box:{min:[-.12,.22,-1.25],max:[.12,1.24,-.99]}},
  {mode:'never',bones:['tail_1*'],box:{min:[-.5,-.1,-.98],max:[.5,1.15,1.5]}}
]});
writeFileSync('.cache/horse-v4/rig-fitted-report.json',JSON.stringify(rig.status(),null,2));
writeFileSync('.cache/horse-v4/rig-fitted.png',(await rig.render({views:['left','front'],size:800})).png);
const binding=rig.bind_report({},'limbs');
writeFileSync('.cache/horse-v4/binding.json',JSON.stringify(binding,null,2));
for(const time of [0,.12,.25,.36]){
  const report=await rig.render({views:['left'],size:850,animation:'Run',time,labels:'none',joints:'none'});
  writeFileSync(`.cache/horse-v4/run-${time}.png`,report.png);
  console.log('POSE',JSON.stringify(report.pose));
}
console.log(await rig.export({output:'.cache/horse-v4/horse-rigged.glb',animations:['Idle','Run','Walk'],rest_rotations:'limbs'}));
