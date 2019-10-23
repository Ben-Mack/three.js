/**
 * @author donmccurdy / https://www.donmccurdy.com
 *
 * Specification: http://github.khronos.org/KTX-Specification/
 */

import {
	CompressedTexture,
	CompressedTextureLoader,
	FileLoader,
	Loader
} from "../../../build/three.module.js";
import { BasisTextureLoader } from "../loaders/BasisTextureLoader.js";


var KTX2Loader = function ( manager ) {

	Loader.call( this, manager );

	this.basisLoader = new BasisTextureLoader( manager );

};

KTX2Loader.prototype = Object.assign( Object.create( CompressedTextureLoader.prototype ), {

	constructor: KTX2Loader,

	setTranscoderPath: function ( path ) {

		this.basisLoader.setTranscoderPath( path );

		return this;

	},

	setWorkerLimit: function ( workerLimit ) {

		this.basisLoader.setWorkerLimit( workerLimit );

		return this;

	},

	detectSupport: function ( renderer ) {

		this.basisLoader.detectSupport( renderer );

		return this;

	},

	load: function ( url, onLoad, onProgress, onError ) {

		var scope = this;

		var images = [];

		var texture = new CompressedTexture();
		texture.image = images;

		var loader = new FileLoader( this.manager );
		loader.setPath( this.path );
		loader.setResponseType( 'arraybuffer' );

		loader.load( url, function ( buffer ) {

			scope.parse( buffer, function ( image ) {

				console.log( 'TODO: Got image... ' , image );

				if ( onLoad ) onLoad( texture );

			}, onError );

		}, onProgress, onError );

		return texture;

	},

	parse: function ( buffer, onLoad, onError ) {

		var ktx = new KhronosTextureContainer( buffer );

		ktx.initMipmaps()
			.then( function () {

				onLoad( {
					mipmaps: ktx.mipmaps,
					width: ktx.pixelWidth,
					height: ktx.pixelHeight,
					format: ktx.glInternalFormat, // ???
					isCubemap: ktx.faceCount === 6,
					mipmapCount: ktx.levelCount
				} );

			} )
			.catch( onError );

		return this;

	}

} );

var KhronosTextureContainer = ( function () {

	function KhronosTextureContainer( arrayBuffer ) {

		this.arrayBuffer = arrayBuffer;

		this.mipmaps = null;

		// Confirm this is a KTX 2.0 file, based on the identifier in the first 12 bytes.
		var idByteLength = 12;
		var id = new Uint8Array( this.arrayBuffer, 0, idByteLength );
		if ( id[ 0 ] !== 0xAB || // '´'
				id[ 1 ] !== 0x4B ||  // 'K'
				id[ 2 ] !== 0x54 ||  // 'T'
				id[ 3 ] !== 0x58 ||  // 'X'
				id[ 4 ] !== 0x20 ||  // ' '
				id[ 5 ] !== 0x32 ||  // '2'
				id[ 6 ] !== 0x30 ||  // '0'
				id[ 7 ] !== 0xBB ||  // 'ª'
				id[ 8 ] !== 0x0D ||  // '\r'
				id[ 9 ] !== 0x0A ||  // '\n'
				id[ 10 ] !== 0x1A || // '\x1A'
				id[ 11 ] !== 0x0A    // '\n'
			) {

			console.error( 'THREE.KTX2Loader: Missing KTX 2.0 identifier.' );
			return;

		}

		var dataSize = Uint32Array.BYTES_PER_ELEMENT;
		var headerByteLength = 17 * dataSize;
		var headerDataView = new DataView( this.arrayBuffer, idByteLength, headerByteLength );

		// TODO: If we need to support BE, derive this from typeSize.
		var littleEndian = true;

		var headerIndex = 0;

		// Header.

		this.vkFormat = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.typeSize = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.pixelWidth = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.pixelHeight = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.pixelDepth = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.arrayElementCount = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.faceCount = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.levelCount = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.supercompressionScheme = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );

		if ( this.vkFormat !== 0 ) {

			console.warn( 'THREE.KTX2Loader: Unknown vkFormat, "' + this.vkFormat + '".' );
			// Continue.

		}

		if ( this.supercompressionScheme !== 1 ) {

			console.warn( 'THREE.KTX2Loader: Only Basis Universal supercompression is currently supported.' );
			return;

		}

		if ( this.pixelDepth > 0 ) {

			console.warn( 'THREE.KTX2Loader: Only 2D textures are currently supported.' );
			return;

		}

		if ( this.arrayElementCount > 1 ) {

			console.warn( 'THREE.KTX2Loader: Array textures are not currently supported.' );
			return;

		}

		if ( this.faceCount > 1 ) {

			console.warn( 'THREE.KTX2Loader: Cube textures are not currently supported.' );
			return;

		}

		// Index.

		this.dfdByteOffset = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.dfdByteLength = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.kvdByteOffset = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.kvdByteLength = headerDataView.getUint32( headerIndex++ * dataSize, littleEndian );
		this.sgdByteOffset = getUint64( headerDataView, headerIndex * dataSize, littleEndian ); headerIndex += 2;
		this.sgdByteLength = getUint64( headerDataView, headerIndex * dataSize, littleEndian ); headerIndex += 2;

		// Level index.

		var levelDataSize = Uint32Array.BYTES_PER_ELEMENT * 2;
		var levelDataView = new DataView( this.arrayBuffer, idByteLength + headerByteLength, this.levelCount * 3 * levelDataSize );
		var levelIndex = 0;

		this.levels = [];

		for ( var i = 0; i < this.levelCount; i ++ ) {

			var level = {
				byteOffset: getUint64( levelDataView, levelIndex++ * levelDataSize, littleEndian ),
				byteLength: getUint64( levelDataView, levelIndex++ * levelDataSize, littleEndian ),
				uncompressedByteLength: getUint64( levelDataView, levelIndex++ * levelDataSize, littleEndian )
			};

			level.bytes = new Uint8Array( this.arrayBuffer, level.byteOffset, level.byteLength );

			this.levels.push( level );

		}

		// Data Format Descriptor (not implemented).

		// Key/Value Data (not implemented).

		// Supercompression Global Data.

		this.globalData = new Uint8Array( this.arrayBuffer, this.sgdByteOffset, this.sgdByteLength );

	}

	KhronosTextureContainer.prototype.initMipmaps = function () {

		var scope = this;

		var mipmaps = [];
		var width = this.pixelWidth;
		var height = this.pixelHeight;

		for ( var level = 0; level < this.levelCount; level ++ ) {

			// var imageSize = new Int32Array( this.arrayBuffer, dataOffset, 1 )[ 0 ]; // size per face, since not supporting array cubemaps
			// dataOffset += 4; // size of the image + 4 for the imageSize field

			// for ( var face = 0; face < this.faceCount; face ++ ) {

			// 	var byteArray = new Uint8Array( this.arrayBuffer, dataOffset, imageSize );

			// 	mipmaps.push( { "data": byteArray, "width": width, "height": height } );

			// 	dataOffset += imageSize;
			// 	dataOffset += 3 - ( ( imageSize + 3 ) % 4 ); // add padding for odd sized image

			// }
			// width = Math.max( 1.0, width * 0.5 );
			// height = Math.max( 1.0, height * 0.5 );

		}

		return new Promise( function ( resolve, reject ) {

			scope.mipmaps = mipmaps;

			resolve();

		} );

	};

	// https://stackoverflow.com/questions/53103695/
	function getUint64 ( view, byteOffset, littleEndian ) {

		var left =  view.getUint32( byteOffset, littleEndian );
		var right = view.getUint32( byteOffset + 4, littleEndian );
		var combined = littleEndian ? left + ( 2 ** 32 * right ) : ( 2 ** 32 * left ) + right;

		if ( ! Number.isSafeInteger( combined ) ) {

			console.warn( 'THREE.KTX2Loader: ' + combined + ' exceeds MAX_SAFE_INTEGER. Precision may be lost.' );

	 	}

		return combined;

	}

	return KhronosTextureContainer;

}() );


export { KTX2Loader };
