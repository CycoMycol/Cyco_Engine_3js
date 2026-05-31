import { TempNode } from 'three/webgpu';
import {
	nodeObject,
	Fn,
	convertToTexture,
	float,
	vec2,
	vec4,
	uv,
} from 'three/tsl';

/**
 * Post processing node for applying chromatic aberration effect.
 * Simulates the colour fringing that occurs in real camera lenses by
 * separating and offsetting the red, green, and blue channels.
 *
 * @augments TempNode
 * @three_import import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
 */
class ChromaticAberrationNode extends TempNode {

	static get type() {
		return 'ChromaticAberrationNode';
	}

	constructor( textureNode, strengthNode, centerNode, scaleNode ) {
		super( 'vec4' );
		this.textureNode  = textureNode;
		this.strengthNode = strengthNode;
		this.centerNode   = centerNode;
		this.scaleNode    = scaleNode;
	}

	setup( /* builder */ ) {

		const textureNode = this.textureNode;
		const uvNode = textureNode.uvNode || uv();

		const ApplyChromaticAberration = Fn( ( [ uvIn, strength, center, scale ] ) => {

			const offset    = uvIn.sub( center );
			const dist      = offset.length();

			// Each RGB channel gets a different radial scale
			const redScale   = float( 1.0 ).add( scale.mul( 0.02 ).mul( strength ) );
			const greenScale = float( 1.0 );
			const blueScale  = float( 1.0 ).sub( scale.mul( 0.02 ).mul( strength ) );

			const aberrationStrength = strength.mul( dist );

			const redUV   = center.add( offset.mul( redScale ) );
			const greenUV = center.add( offset.mul( greenScale ) );
			const blueUV  = center.add( offset.mul( blueScale ) );

			const rOffset = offset.mul( aberrationStrength ).mul( float(  0.01 ) );
			const gOffset = offset.mul( aberrationStrength ).mul( float(  0.0  ) );
			const bOffset = offset.mul( aberrationStrength ).mul( float( -0.01 ) );

			const finalRedUV   = redUV.add( rOffset );
			const finalGreenUV = greenUV.add( gOffset );
			const finalBlueUV  = blueUV.add( bOffset );

			const r = textureNode.sample( finalRedUV   ).r;
			const g = textureNode.sample( finalGreenUV ).g;
			const b = textureNode.sample( finalBlueUV  ).b;
			const a = textureNode.sample( uvIn ).a;

			return vec4( r, g, b, a );

		} ).setLayout( {
			name: 'ChromaticAberrationShader',
			type: 'vec4',
			inputs: [
				{ name: 'uv',       type: 'vec2'  },
				{ name: 'strength', type: 'float' },
				{ name: 'center',   type: 'vec2'  },
				{ name: 'scale',    type: 'float' },
			],
		} );

		const chromaticAberrationFn = Fn( () => {
			return ApplyChromaticAberration(
				uvNode,
				this.strengthNode,
				this.centerNode,
				this.scaleNode,
			);
		} );

		return chromaticAberrationFn();
	}
}

export default ChromaticAberrationNode;

/**
 * TSL function for applying chromatic aberration to a node.
 *
 * @tsl
 * @function
 * @param {Node<vec4>}          node          The input colour node.
 * @param {Node|number}         [strength=1]  Aberration strength.
 * @param {?(Node|Vector2)}     [center=null] Screen-space centre. Defaults to (0.5, 0.5).
 * @param {Node|number}         [scale=1.1]   Stepped scale factor.
 * @returns {ChromaticAberrationNode}
 */
export const chromaticAberration = ( node, strength = 1.0, center = null, scale = 1.1 ) => {

	// Null-safe centre: convert null to screen-centre vec2 constant.
	const centerNode = ( center !== null ) ? nodeObject( center ) : vec2( 0.5, 0.5 );

	return nodeObject(
		new ChromaticAberrationNode(
			convertToTexture( node ),
			nodeObject( strength ),
			centerNode,
			nodeObject( scale ),
		)
	);

};
