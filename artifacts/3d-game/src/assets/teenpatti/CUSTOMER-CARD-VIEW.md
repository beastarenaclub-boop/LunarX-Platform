# Customer card readability

Auto view now has two fixed regions: the full filmed dealer and table above,
and six upright cards below, grouped as Player A and Player B. This solves
the severe foreshortening of ranks in the filmed table angle without changing
the paper's orientation or cutting to another angle at settlement.

`CustomerCardView.tsx` uses the same authoritative card values and decoded
flat-paper cues as the filmed cards. Every new round starts with backs;
individual faces appear only after their corresponding filmed turn. Once
revealed, the readable face remains visible across a decoder seek. Both
regions keep their positions through the result. Manual Cards view remains
available and uses the same larger corner indices.

`filmCameraFrame` fits the complete 864 × 496 source frame at full table width and reserves space
for the readable cards and footer. Auto view keeps the head, hands and paper
visible during opening and settlement. It no longer magnifies the hand crop.
The readable region appears after the framing transition. The container grows
vertically for the cards (at least 430px) instead of reducing the dealer's
width during opening. Betting and opening use the same width-to-source scale.
The source video resolution and card timing are
unchanged; removing the crop enlargement and runtime color filter preserves
more apparent detail without adding video bytes or a second decoder.

The cards preserve their 66:94 aspect ratio and use jumbo rank/suit indices.
Browser coverage checks all six cards, ordered server values, reveal gating,
head/hand visibility, card-panel separation, no overlapping cards, at least 50px card height
and 12px rendered corner ranks at 320, 390, 640, 844 and 1440px viewports.
It also checks the first zoom frames and unchanged opening/result transforms.

Dealer media, eye-only betting, hand performance, 20-second betting and
audio are unchanged. See [EYES-AND-CARD-DIRECTION.md](EYES-AND-CARD-DIRECTION.md)
for the media preparation and paper timing.
