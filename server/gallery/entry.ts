export type GalleryEntry<Data = unknown> = {
  readonly name: string;
  readonly render: (data: Data) => string;
  readonly sample: Data;
};
