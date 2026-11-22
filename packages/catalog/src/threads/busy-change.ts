/**
 * What a catalog thread says, unasked, as it starts or stops making something large beside
 * answering calls: a view's order, which the reader has its views' thread make, or the folder
 * tree's skeleton, which the writer makes once writes stop. The status bar shows it.
 */
export interface MakingNews {
  making: 'views' | 'skeleton';
  busy: boolean;
}
