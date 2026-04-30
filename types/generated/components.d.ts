import type { Schema, Struct } from '@strapi/strapi';

export interface DestinationSection extends Struct.ComponentSchema {
  collectionName: 'components_destination_sections';
  info: {
    description: 'Ordered editorial section for destination storytelling';
    displayName: 'Section';
  };
  attributes: {
    body: Schema.Attribute.RichText;
    section_number: Schema.Attribute.Integer;
    title: Schema.Attribute.String;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'destination.section': DestinationSection;
    }
  }
}
