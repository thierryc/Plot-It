import type { ArtworkItem } from './model';
import { editTypography, textOptions, type LoadedFont } from './typography';
const basicTags = new Set(['kern','liga','clig','calt']);
/** Prepare replacements first so a failed font or shape cannot partially update a block. */
export function withBasicTextDefaults(item: ArtworkItem, font: LoadedFont): ArtworkItem | undefined {
  if (!item.text) return;
  const options=textOptions(item), tags=new Set(font.features.filter(tag=>basicTags.has(tag)));
  if(font.openplotfont?.kerning?.length)tags.add('kern');
  if(!tags.size)return;
  const updated=structuredClone(options);
  if(tags.has('kern'))updated.kerning=true;
  if(tags.has('liga')||tags.has('clig'))updated.ligatures=true;
  if(tags.has('calt'))updated.contextual=true;
  updated.features=options.features.split(',').map(token=>token.trim()).filter(token=>token&&!tags.has(token.replace(/^[+-]/,'').slice(0,4))).join(', ');
  if(options.featureRanges)updated.featureRanges=options.featureRanges.filter(range=>!tags.has(range.tag));
  // An explicit ligature preference must also work on blocks with tracking.
  if(options.letterSpacing)for(const tag of ['liga','clig'])if(tags.has(tag))updated.features=[updated.features,`${tag}=1`].filter(Boolean).join(', ');
  if(JSON.stringify(updated)===JSON.stringify(options))return;
  const replacement=structuredClone(item);
  editTypography(replacement,item.text.content,undefined,updated);
  return replacement;
}
