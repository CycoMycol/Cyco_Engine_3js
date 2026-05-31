import { TempNode } from 'three/webgpu';
import { rand, Fn, fract, time, uv, clamp, mix, vec4, nodeProxy } from 'three/tsl';

/**
 * Post processing node for creating an animated film-grain effect.
 * Uses the built-in TSL `time` node so the grain animates automatically
 * every frame without any manual time-uniform updates.
 *
 * @augments TempNode
 * @three_import import { film } from 'three/addons/tsl/display/FilmNode.js';
 */
class FilmNode extends TempNode {

	static get type() {
		return 'FilmNode';
	}

	/**
	 * @param {Node}       inputNode          Input colour node.
	 * @param {?Node}      [intensityNode]    Effect intensity (0 = off, 1 = full).
	 * @param {?Node<vec2>} [uvNode]          Custom UV node (uses screen UV if omitted).
	 */
	constructor( inputNode, intensityNode = null, uvNode = null ) {
		super( 'vec4' );
		this.inputNode     = inputNode;
		this.intensityNode = intensityNode;
		this.uvNode        = uvNode;
	}

	setup( /* builder */ ) {

		const uvNode = this.uvNode || uv();

		const film = Fn( () => {

			const base  = this.inputNode.rgb;
			const noise = rand( fract( uvNode.add( time ) ) );

			// Add noise on top of base colour, then mix by intensity
			let color = base.add( base.mul( clamp( noise.add( 0.1 ), 0, 1 ) ) );

			if ( this.intensityNode !== null ) {
				color = mix( base, color, this.intensityNode );
			}

			return vec4( color, this.inputNode.a );

		} );

		return film();
	}
}

export default FilmNode;

/**
 * TSL function for applying film grain to a node.
 *
 * @tsl
 * @function
 * @param {Node<vec4>}  inputNode          The input colour node.
 * @param {?Node<float>} [intensityNode]   Effect intensity (0 = off, 1 = full). Defaults to 1.
 * @param {?Node<vec2>}  [uvNode]          Custom UV node.
 * @returns {FilmNode}
 */
export const film = /*@__PURE__*/ nodeProxy( FilmNode );
