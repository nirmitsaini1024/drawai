import {
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  createTLSchema,
  defaultBindingSchemas,
  defaultShapeSchemas,
  DefaultColorStyle,
  DefaultSizeStyle,
  T,
} from 'tldraw'

/** Keep in sync with `src/library/presetKinds.ts` (server cannot import TS). */
const PRESET_KINDS = [
  'rect',
  'rounded-rect',
  'ellipse',
  'diamond',
  'cloud',
  'hexagon',
  'note',
  'database',
  'server',
  'queue',
  'cache',
  'api-gateway',
  'load-balancer',
  'person',
  'browser',
  'mobile',
  'firewall',
  'ec2',
  's3',
  'lambda',
  'rds',
  'dynamodb',
  'sqs',
  'sns',
  'cloudfront',
  'aws-api-gateway',
  'vpc',
  'start-end',
  'process',
  'decision',
  'input-output',
  'document',
]

/** Must match `IconShapeUtil` migrations in `src/shapes/IconShapeUtil.tsx`. */
const iconVersions = createShapePropsMigrationIds('icon', {
  AddSize: 1,
})

const iconMigrations = createShapePropsMigrationSequence({
  sequence: [
    {
      id: iconVersions.AddSize,
      up(props) {
        props.size = props.size ?? 'm'
      },
      down(props) {
        delete props.size
      },
    },
  ],
})

export const roomSchema = createTLSchema({
  shapes: {
    ...defaultShapeSchemas,
    icon: {
      props: {
        kind: T.literalEnum(...PRESET_KINDS),
        w: T.number,
        h: T.number,
        label: T.string,
        color: DefaultColorStyle,
        size: DefaultSizeStyle,
      },
      migrations: iconMigrations,
    },
    dnode: {
      props: {
        shape: T.string,
        tone: T.string,
        label: T.string,
        description: T.string,
        icon: T.string,
        w: T.number,
        h: T.number,
        look: T.literalEnum('clean', 'sketch'),
      },
    },
    dgroup: {
      props: {
        label: T.string,
        tone: T.string,
        w: T.number,
        h: T.number,
        look: T.literalEnum('clean', 'sketch'),
      },
    },
  },
  bindings: defaultBindingSchemas,
})
